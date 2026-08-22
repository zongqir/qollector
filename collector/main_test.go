package main

import (
	"strings"
	"testing"
)

func TestNormalizeTruncatesByUnicodeCharacters(t *testing.T) {
	c := &collector{cfg: config{MaxTextChars: 3, PreviewChars: 2}}
	event, err := c.normalize(incomingEvent{
		EventID:     "event-1",
		ContentType: "text/plain",
		Content:     "你a好世界",
	})
	if err != nil {
		t.Fatalf("normalize returned error: %v", err)
	}
	if event.Content != "你a" {
		t.Fatalf("unexpected preview %q", event.Content)
	}
	if event.OriginalChars != 5 || !event.Truncated {
		t.Fatalf("unexpected truncation metadata: %+v", event)
	}
}

func TestNormalizeKeepsShortText(t *testing.T) {
	c := &collector{cfg: config{MaxTextChars: 20, PreviewChars: 2}}
	event, err := c.normalize(incomingEvent{ContentType: "text", Content: "hello"})
	if err != nil {
		t.Fatalf("normalize returned error: %v", err)
	}
	if event.Content != "hello" || event.Truncated {
		t.Fatalf("short text was changed: %+v", event)
	}
	if len(strings.TrimSpace(event.ContentSHA256)) == 0 {
		t.Fatal("content hash is missing")
	}
}

func TestNormalizeStoresAITags(t *testing.T) {
	c := &collector{cfg: config{MaxTextChars: 20, PreviewChars: 2}}
	event, err := c.normalize(incomingEvent{
		ContentType: "text",
		Content:     "hello",
		AITags:      []string{" Rust ", "", "analysis"},
	})
	if err != nil {
		t.Fatalf("normalize returned error: %v", err)
	}
	if got, want := strings.Join(event.AITags, ","), "Rust,analysis"; got != want {
		t.Fatalf("unexpected AI tags %q", got)
	}
}

func TestNormalizeRejectsNonTextContent(t *testing.T) {
	c := &collector{cfg: config{MaxTextChars: 20, PreviewChars: 2}}
	if _, err := c.normalize(incomingEvent{ContentType: "image/png", Content: "ignored"}); err == nil {
		t.Fatal("expected image content to be rejected")
	}
}
