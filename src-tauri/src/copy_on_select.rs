use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub struct CopyOnSelectState {
    enabled: AtomicBool,
    double_click_enabled: AtomicBool,
}

impl CopyOnSelectState {
    pub fn new(enabled: bool, double_click_enabled: bool) -> Self {
        Self {
            enabled: AtomicBool::new(enabled),
            double_click_enabled: AtomicBool::new(double_click_enabled),
        }
    }

    pub fn update(&self, enabled: bool, double_click_enabled: bool) {
        self.enabled.store(enabled, Ordering::Relaxed);
        self.double_click_enabled.store(double_click_enabled, Ordering::Relaxed);
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    pub fn is_double_click_enabled(&self) -> bool {
        self.double_click_enabled.load(Ordering::Relaxed)
    }
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::*;
    use parking_lot::Mutex;
    use std::sync::LazyLock;
    use std::time::{Duration, Instant};
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetDoubleClickTime, GetForegroundWindow, GetMessageW,
        GetSystemMetrics, GetWindowThreadProcessId, SetWindowsHookExW, TranslateMessage,
        HC_ACTION, HHOOK, MSG, MSLLHOOKSTRUCT, SM_CXDOUBLECLK, SM_CYDOUBLECLK,
        WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP,
    };

    static COPY_ON_SELECT_STATE: LazyLock<Mutex<Option<Arc<CopyOnSelectState>>>> =
        LazyLock::new(|| Mutex::new(None));

    struct MouseClickState {
        last_down_pt: (i32, i32),
        last_down_time: Instant,
        last_up_pt: (i32, i32),
        last_up_time: Instant,
        last_trigger_time: Instant,
    }

    static CLICK_TRACKER: LazyLock<Mutex<MouseClickState>> = LazyLock::new(|| {
        let now = Instant::now();
        Mutex::new(MouseClickState {
            last_down_pt: (0, 0),
            last_down_time: now,
            last_up_pt: (0, 0),
            last_up_time: now,
            last_trigger_time: now,
        })
    });

    unsafe extern "system" fn mouse_hook_proc(
        n_code: i32,
        w_param: WPARAM,
        l_param: LPARAM,
    ) -> LRESULT {
        if n_code >= HC_ACTION as i32 {
            let state_opt = COPY_ON_SELECT_STATE.lock().clone();
            if let Some(state) = state_opt {
                if state.is_enabled() {
                    let msg = w_param.0 as u32;
                    let info = *(l_param.0 as *const MSLLHOOKSTRUCT);
                    let pt = (info.pt.x, info.pt.y);

                    // Skip synthetic/injected events (bit 0 of flags is LLMHF_INJECTED)
                    let is_injected = (info.flags.0 & 1) != 0;

                    if !is_injected {
                        match msg {
                            WM_LBUTTONDOWN => {
                                let now = Instant::now();
                                let mut tracker = CLICK_TRACKER.lock();
                                tracker.last_down_pt = pt;
                                tracker.last_down_time = now;
                            }
                            WM_LBUTTONUP => {
                                let now = Instant::now();
                                let mut tracker = CLICK_TRACKER.lock();
                                let down_pt = tracker.last_down_pt;
                                let last_up_pt = tracker.last_up_pt;
                                let last_up_time = tracker.last_up_time;
                                let last_trigger = tracker.last_trigger_time;

                                tracker.last_up_pt = pt;
                                tracker.last_up_time = now;

                                // 1. Check drag distance: >= 5px
                                let dx = pt.0 - down_pt.0;
                                let dy = pt.1 - down_pt.1;
                                let drag_dist_sq = dx * dx + dy * dy;
                                let is_drag = drag_dist_sq >= 25; // 5px threshold

                                // 2. Check double click (word selection)
                                let dbl_click_enabled = state.is_double_click_enabled();
                                let dbl_time_limit = GetDoubleClickTime().max(200) as u128;
                                let cx_dbl = GetSystemMetrics(SM_CXDOUBLECLK).max(4);
                                let cy_dbl = GetSystemMetrics(SM_CYDOUBLECLK).max(4);

                                let is_double_click = if dbl_click_enabled {
                                    let up_interval = now.duration_since(last_up_time).as_millis();
                                    let click_dx = (pt.0 - last_up_pt.0).abs();
                                    let click_dy = (pt.1 - last_up_pt.1).abs();
                                    up_interval <= dbl_time_limit
                                        && click_dx <= cx_dbl
                                        && click_dy <= cy_dbl
                                } else {
                                    false
                                };

                                let should_trigger = is_drag || is_double_click;

                                // Debounce: avoid duplicate triggers within 150ms
                                if should_trigger
                                    && now.duration_since(last_trigger).as_millis() > 150
                                {
                                    if !is_excluded_context() {
                                        tracker.last_trigger_time = now;
                                        // Spawn a lightweight task to delay-send Ctrl+C so host app settles selection
                                        std::thread::spawn(|| {
                                            std::thread::sleep(Duration::from_millis(50));
                                            send_ctrl_c();
                                        });
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }

        CallNextHookEx(None, n_code, w_param, l_param)
    }

    fn is_excluded_context() -> bool {
        unsafe {
            // Check modifier keys (Ctrl, Alt, Win)
            let is_ctrl = (GetAsyncKeyState(VK_CONTROL.0 as i32) as u16 & 0x8000) != 0;
            let is_alt = (GetAsyncKeyState(VK_MENU.0 as i32) as u16 & 0x8000) != 0;
            let is_win = ((GetAsyncKeyState(VK_LWIN.0 as i32) as u16 & 0x8000) != 0)
                || ((GetAsyncKeyState(VK_RWIN.0 as i32) as u16 & 0x8000) != 0);

            if is_ctrl || is_alt || is_win {
                return true;
            }

            // Check if active foreground window is Qollect itself
            let hwnd = GetForegroundWindow();
            if !hwnd.is_invalid() {
                let mut pid = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                if pid == std::process::id() {
                    return true;
                }
            }

            false
        }
    }

    fn send_ctrl_c() {
        const VK_C_KEY: u16 = 0x43;

        fn key_input(vk: u16, key_up: bool) -> INPUT {
            let flags = if key_up {
                KEYEVENTF_KEYUP
            } else {
                Default::default()
            };

            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(vk),
                        wScan: 0,
                        dwFlags: flags,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            }
        }

        let inputs = [
            key_input(VK_CONTROL.0, false),
            key_input(VK_C_KEY, false),
            key_input(VK_C_KEY, true),
            key_input(VK_CONTROL.0, true),
        ];

        unsafe {
            let _ = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
    }

    pub fn start_monitor(state: Arc<CopyOnSelectState>) {
        *COPY_ON_SELECT_STATE.lock() = Some(state);

        std::thread::spawn(|| unsafe {
            let hook: Result<HHOOK, _> =
                SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), None, 0);

            match hook {
                Ok(hhook) => {
                    println!("[CopyOnSelect] Low-level mouse hook installed successfully");
                    let mut msg = MSG::default();
                    while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                    let _ = windows::Win32::UI::WindowsAndMessaging::UnhookWindowsHookEx(hhook);
                }
                Err(err) => {
                    eprintln!("[CopyOnSelect] Failed to install mouse hook: {}", err);
                }
            }
        });
    }
}

pub fn start_copy_on_select_monitor(state: Arc<CopyOnSelectState>) {
    #[cfg(target_os = "windows")]
    {
        windows_impl::start_monitor(state);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
    }
}
