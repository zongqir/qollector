/// Cross-platform cursor position retrieval.

#[derive(Debug, Clone, Copy)]
pub struct CursorPosition {
    pub x: i32,
    pub y: i32,
}

/// Returns the current global cursor position in screen coordinates.
/// Falls back to (0, 0) on failure.
pub fn get_cursor_position() -> CursorPosition {
    platform_impl::get_cursor_position_impl()
}

// ── Windows ──────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
mod platform_impl {
    use super::CursorPosition;

    pub fn get_cursor_position_impl() -> CursorPosition {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

        let mut point = POINT { x: 0, y: 0 };
        unsafe {
            let _ = GetCursorPos(&mut point);
        }
        CursorPosition {
            x: point.x,
            y: point.y,
        }
    }
}

// ── Linux ────────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
mod platform_impl {
    use super::CursorPosition;

    pub fn get_cursor_position_impl() -> CursorPosition {
        if let Ok(pos) = query_x11_cursor() {
            return pos;
        }
        CursorPosition { x: 0, y: 0 }
    }

    fn query_x11_cursor() -> Result<CursorPosition, Box<dyn std::error::Error>> {
        let (conn, screen_num) = x11rb::connect(None)?;
        let screen = &conn.setup().roots[screen_num];
        let reply = x11rb::protocol::xproto::query_pointer(&conn, screen.root)?.reply()?;
        Ok(CursorPosition {
            x: reply.root_x as i32,
            y: reply.root_y as i32,
        })
    }
}

// ── macOS ────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod platform_impl {
    use super::CursorPosition;

    pub fn get_cursor_position_impl() -> CursorPosition {
        use cocoa::base::nil;
        use cocoa::foundation::NSRect;
        use objc::{class, msg_send, sel, sel_impl};

        unsafe {
            // [NSEvent mouseLocation] - class method
            let location: cocoa::foundation::NSPoint = msg_send![class!(NSEvent), mouseLocation];

            // Get primary screen height for coordinate conversion (bottom-left -> top-left)
            let screens: cocoa::base::id = msg_send![class!(NSScreen), screens];
            let primary: cocoa::base::id = msg_send![screens, objectAtIndex: 0usize];
            let frame: NSRect = msg_send![primary, frame];

            let y = frame.size.height - location.y;
            CursorPosition {
                x: location.x as i32,
                y: y as i32,
            }
        }
    }
}
