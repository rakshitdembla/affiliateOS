use keyring::Entry;
use tauri::Manager;

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

/// Only plain CSV file names: letters, digits, dot, dash, underscore; must end in .csv.
fn safe_csv_name(name: &str) -> Option<String> {
    let cleaned: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')).take(120).collect();
    if cleaned.starts_with('.') || !cleaned.to_ascii_lowercase().ends_with(".csv") || cleaned.len() < 5 {
        return None;
    }
    Some(cleaned)
}

/// Save an analytics export into ~/Downloads (never overwrites) and reveal it in Finder.
#[tauri::command]
fn save_export(app: tauri::AppHandle, file_name: String, contents: String) -> Result<String, String> {
    if contents.len() > 50 * 1024 * 1024 {
        return Err("export is too large".into());
    }
    let name = safe_csv_name(&file_name).ok_or_else(|| "invalid file name".to_string())?;
    let dir = app.path().download_dir().map_err(|_| "Downloads folder not found".to_string())?;
    let stem = name.trim_end_matches(".csv").to_string();
    let mut path = dir.join(&name);
    let mut n = 1;
    while path.exists() {
        path = dir.join(format!("{stem}-{n}.csv"));
        n += 1;
    }
    std::fs::write(&path, contents).map_err(|_| "could not write the file".to_string())?;
    let _ = tauri_plugin_opener::reveal_item_in_dir(&path);
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn csv_names_are_sanitized() {
        assert_eq!(super::safe_csv_name("affiliateos-clicks-2026-11-01.csv").as_deref(), Some("affiliateos-clicks-2026-11-01.csv"));
        assert_eq!(super::safe_csv_name("../../etc/passwd.csv"), None);
        assert_eq!(super::safe_csv_name("report.exe"), None);
        assert_eq!(super::safe_csv_name(".hidden.csv"), None);
        assert_eq!(super::safe_csv_name("a b/c.csv").as_deref(), Some("abc.csv"));
    }

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
        .invoke_handler(tauri::generate_handler![secret_get, secret_set, secret_delete, save_export])
        .run(tauri::generate_context!())
        .expect("error while running AffiliateOS");
}
