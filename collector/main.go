package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	_ "time/tzdata"
	"unicode/utf8"
)

const (
	defaultPort            = "8080"
	defaultDataDir         = "/data/events"
	defaultRetentionDays   = 30
	defaultMaxTextChars    = 2000
	defaultPreviewChars    = 200
	defaultMaxRequestBytes = 256 * 1024
	cleanupInterval        = time.Hour
	maxEventIDLength       = 200
)

type config struct {
	Token          string
	Port           string
	DataDir        string
	RetentionDays  int
	MaxTextChars   int
	PreviewChars   int
	MaxRequestSize int64
	Location       *time.Location
}

type incomingEvent struct {
	EventID     string `json:"event_id"`
	CapturedAt  string `json:"captured_at"`
	ContentType string `json:"content_type"`
	Content     string `json:"content"`
	SourceApp   string `json:"source_app,omitempty"`
}

type storedEvent struct {
	EventID       string `json:"event_id"`
	CapturedAt    string `json:"captured_at"`
	ReceivedAt    string `json:"received_at"`
	ContentType   string `json:"content_type"`
	Content       string `json:"content"`
	SourceApp     string `json:"source_app,omitempty"`
	OriginalChars int    `json:"original_chars"`
	ContentSHA256 string `json:"content_sha256"`
	Truncated     bool   `json:"truncated"`
}

type collector struct {
	cfg    config
	mu     sync.Mutex
	rateMu sync.Mutex
	rate   map[string][]time.Time
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}

	if err := os.MkdirAll(cfg.DataDir, 0o750); err != nil {
		log.Fatalf("create data directory: %v", err)
	}

	c := &collector{cfg: cfg, rate: make(map[string][]time.Time)}
	c.pruneOldDays(time.Now())
	go c.cleanupLoop()

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", c.handleHealth)
	mux.HandleFunc("/v1/clipboard-events", c.handleEvent)

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           loggingMiddleware(mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	log.Printf("qollect collector listening on :%s, data=%s, retention=%dd", cfg.Port, cfg.DataDir, cfg.RetentionDays)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func loadConfig() (config, error) {
	token := strings.TrimSpace(os.Getenv("QOLLECT_TOKEN"))
	if token == "" {
		return config{}, errors.New("QOLLECT_TOKEN is required")
	}

	retentionDays, err := envInt("QOLLECT_RETENTION_DAYS", defaultRetentionDays, 1, 3650)
	if err != nil {
		return config{}, err
	}
	maxTextChars, err := envInt("QOLLECT_MAX_TEXT_CHARS", defaultMaxTextChars, 200, 1000000)
	if err != nil {
		return config{}, err
	}
	previewChars, err := envInt("QOLLECT_PREVIEW_CHARS", defaultPreviewChars, 1, 10000)
	if err != nil {
		return config{}, err
	}

	locationName := strings.TrimSpace(os.Getenv("QOLLECT_TIMEZONE"))
	if locationName == "" {
		locationName = "UTC"
	}
	location, err := time.LoadLocation(locationName)
	if err != nil {
		return config{}, fmt.Errorf("load QOLLECT_TIMEZONE %q: %w", locationName, err)
	}

	return config{
		Token:          token,
		Port:           envString("QOLLECT_PORT", defaultPort),
		DataDir:        envString("QOLLECT_DATA_DIR", defaultDataDir),
		RetentionDays:  retentionDays,
		MaxTextChars:   maxTextChars,
		PreviewChars:   previewChars,
		MaxRequestSize: defaultMaxRequestBytes,
		Location:       location,
	}, nil
}

func envString(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envInt(name string, fallback, min, max int) (int, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < min || parsed > max {
		return 0, fmt.Errorf("%s must be an integer between %d and %d", name, min, max)
	}
	return parsed, nil
}

func (c *collector) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (c *collector) handleEvent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !c.authorized(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if !c.allowRequest(clientIP(r)) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate limit exceeded"})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, c.cfg.MaxRequestSize)
	defer r.Body.Close()

	var event incomingEvent
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&event); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}

	stored, err := c.normalize(event)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "content type") {
			status = http.StatusUnsupportedMediaType
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}

	if err := c.append(stored); err != nil {
		log.Printf("append event failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store failed"})
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"accepted":  true,
		"event_id":  stored.EventID,
		"truncated": stored.Truncated,
	})
}

func clientIP(r *http.Request) string {
	// The collector should normally sit behind a trusted reverse proxy. Do not
	// trust forwarded headers here; the direct peer address is sufficient for
	// the small abuse guard.
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (c *collector) allowRequest(ip string) bool {
	now := time.Now()
	cutoff := now.Add(-time.Minute)
	c.rateMu.Lock()
	defer c.rateMu.Unlock()
	entries := c.rate[ip]
	kept := entries[:0]
	for _, entry := range entries {
		if entry.After(cutoff) {
			kept = append(kept, entry)
		}
	}
	if len(kept) >= 120 {
		c.rate[ip] = kept
		return false
	}
	c.rate[ip] = append(kept, now)
	return true
}

func (c *collector) authorized(r *http.Request) bool {
	const prefix = "Bearer "
	value := r.Header.Get("Authorization")
	if !strings.HasPrefix(value, prefix) {
		return false
	}
	provided := strings.TrimSpace(strings.TrimPrefix(value, prefix))
	if provided == "" || len(provided) != len(c.cfg.Token) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(c.cfg.Token)) == 1
}

func (c *collector) normalize(event incomingEvent) (storedEvent, error) {
	contentType := strings.ToLower(strings.TrimSpace(event.ContentType))
	if !isTextContentType(contentType) {
		return storedEvent{}, fmt.Errorf("unsupported content type %q", event.ContentType)
	}
	if event.Content == "" {
		return storedEvent{}, errors.New("content is required")
	}
	if !utf8.ValidString(event.Content) {
		return storedEvent{}, errors.New("content must be valid UTF-8")
	}

	eventID := strings.TrimSpace(event.EventID)
	if len(eventID) > maxEventIDLength {
		return storedEvent{}, fmt.Errorf("event_id is too long")
	}
	if eventID == "" {
		eventID = fmt.Sprintf("%d", time.Now().UnixNano())
	}

	originalChars := utf8.RuneCountInString(event.Content)
	digest := sha256.Sum256([]byte(event.Content))
	content := event.Content
	truncated := originalChars > c.cfg.MaxTextChars
	if truncated {
		content = string([]rune(event.Content)[:min(c.cfg.PreviewChars, originalChars)])
	}

	capturedAt := strings.TrimSpace(event.CapturedAt)
	if capturedAt == "" {
		capturedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}

	return storedEvent{
		EventID:       eventID,
		CapturedAt:    capturedAt,
		ReceivedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		ContentType:   contentType,
		Content:       content,
		SourceApp:     strings.TrimSpace(event.SourceApp),
		OriginalChars: originalChars,
		ContentSHA256: hex.EncodeToString(digest[:]),
		Truncated:     truncated,
	}, nil
}

func isTextContentType(contentType string) bool {
	if contentType == "" || contentType == "text" || contentType == "text/plain" || contentType == "text/uri-list" || contentType == "link" || contentType == "url" || contentType == "markdown" || contentType == "code" {
		return true
	}
	return strings.HasPrefix(contentType, "text/")
}

func (c *collector) append(event storedEvent) error {
	day := time.Now().In(c.cfg.Location).Format("2006/01/02")
	path := filepath.Join(c.cfg.DataDir, day+".jsonl")

	c.mu.Lock()
	defer c.mu.Unlock()

	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()

	encoder := json.NewEncoder(file)
	return encoder.Encode(event)
}

func (c *collector) cleanupLoop() {
	ticker := time.NewTicker(cleanupInterval)
	defer ticker.Stop()
	for now := range ticker.C {
		c.pruneOldDays(now)
	}
}

func (c *collector) pruneOldDays(now time.Time) {
	cutoff := now.In(c.cfg.Location).AddDate(0, 0, -c.cfg.RetentionDays)
	err := filepath.Walk(c.cfg.DataDir, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil || info == nil || info.IsDir() || filepath.Ext(path) != ".jsonl" {
			return walkErr
		}
		relative, err := filepath.Rel(c.cfg.DataDir, path)
		if err != nil {
			return nil
		}
		datePath := strings.TrimSuffix(filepath.ToSlash(relative), ".jsonl")
		date, err := time.ParseInLocation("2006/01/02", datePath, c.cfg.Location)
		if err == nil && date.Before(cutoff) {
			if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
				log.Printf("remove expired event file %s: %v", path, err)
			}
		}
		return nil
	})
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Printf("cleanup failed: %v", err)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func writeJSON(w http.ResponseWriter, status int, value interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s (%s)", r.Method, r.URL.Path, time.Since(started).Round(time.Millisecond))
	})
}
