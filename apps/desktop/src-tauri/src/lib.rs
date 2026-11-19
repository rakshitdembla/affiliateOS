use keyring::Entry;

const SERVICE: &str = "com.affiliateos.desktop";

/// Only these keys may be read/written from the webview.
const ALLOWED_KEYS: &[&str] = &["admin_api_token"];

fn entry(key: &str) -> Result<Entry, String> {
    if !ALLOWED_KEYS.contains(&key) {
        return Err("unknown secret key".into());
    }
    Entry::new(SERVICE, key).map_err(|_| "secure storage unavailable".to_string())
}

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    match entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("failed to read from secure storage".into()),
    }
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    entry(&key)?
        .set_password(&value)
        .map_err(|_| "failed to write to secure storage".to_string())
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("failed to delete from secure storage".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Exercises the real macOS Keychain through the same `keyring` backend the app uses,
    /// with a separate service name so the app's real token is never touched.
    /// Run with: cargo test -- --ignored
    #[test]
    #[ignore = "touches the real macOS Keychain"]
    fn keychain_roundtrip_on_this_mac() {
        let e = keyring::Entry::new("com.affiliateos.desktop.selftest", "probe").unwrap();
        e.set_password("value-1").unwrap();
        assert_eq!(e.get_password().unwrap(), "value-1");
        e.set_password("value-2").unwrap();
        assert_eq!(e.get_password().unwrap(), "value-2");
        e.delete_credential().unwrap();
        assert!(matches!(e.get_password(), Err(keyring::Error::NoEntry)));
    }

    #[test]
    fn rejects_unknown_keys() {
        assert!(secret_get("something_else".into()).is_err());
        assert!(secret_set("something_else".into(), "x".into()).is_err());
        assert!(secret_delete("something_else".into()).is_err());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![secret_get, secret_set, secret_delete])
        .run(tauri::generate_context!())
        .expect("error while running AffiliateOS");
}
