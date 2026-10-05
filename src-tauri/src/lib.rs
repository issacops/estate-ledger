use serde::Deserialize;
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};

#[derive(Deserialize)]
pub struct Stmt {
  pub sql: String,
  #[serde(default)]
  pub params: Vec<serde_json::Value>,
}

#[tauri::command]
async fn exec_tx(
  state: tauri::State<'_, DbInstances>,
  stmts: Vec<Stmt>,
) -> Result<usize, String> {
  let pool = {
    let instances = state.0.read().await;
    match instances.get("sqlite:estate.db") {
      Some(DbPool::Sqlite(pool)) => pool.clone(),
      _ => return Err("database not loaded".to_string()),
    }
  };

  let mut tx = pool.begin().await.map_err(|e: sqlx::Error| e.to_string())?;
  let mut affected = 0usize;

  for stmt in stmts {
    let mut q = sqlx::query(&stmt.sql);
    for p in stmt.params {
      q = match p {
        serde_json::Value::Null => q.bind(None::<String>),
        serde_json::Value::Bool(b) => q.bind(b),
        serde_json::Value::Number(n) => {
          if let Some(i) = n.as_i64() {
            q.bind(i)
          } else {
            q.bind(n.as_f64().unwrap_or(0.0))
          }
        }
        serde_json::Value::String(s) => q.bind(s),
        other => q.bind(other.to_string()),
      };
    }
    let r = q
      .execute(&mut *tx)
      .await
      .map_err(|e: sqlx::Error| e.to_string())?;
    affected += r.rows_affected() as usize;
  }

  tx.commit().await.map_err(|e: sqlx::Error| e.to_string())?;
  Ok(affected)
}

#[tauri::command]
async fn restore_database(
  app: tauri::AppHandle,
  src: String,
) -> Result<(), String> {
  use tauri::Manager;
  let app_data = app
    .path()
    .app_config_dir()
    .map_err(|e| e.to_string())?;
  std::fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
  let dest = app_data.join("estate.db");

  // Refuse anything that is not a SQLite file before touching the live data.
  {
    use std::io::Read;
    let mut header = [0u8; 16];
    let mut f = std::fs::File::open(&src).map_err(|e| format!("Cannot read the backup: {e}"))?;
    f.read_exact(&mut header)
      .map_err(|_| "That file is not an Estate Ledger backup.".to_string())?;
    if &header != b"SQLite format 3\0" {
      return Err("That file is not an Estate Ledger backup.".to_string());
    }
  }

  // Copy first, so a failed copy leaves the live database untouched.
  let staged = app_data.join("estate.db.restore-tmp");
  std::fs::copy(&src, &staged).map_err(|e| format!("Cannot copy the backup: {e}"))?;

  // Keep what was there as a safety copy (copy, not rename: the live file is
  // open, and Windows will not rename an open file).
  if dest.exists() {
    let safety = app_data.join("estate.db.pre-restore.bak");
    std::fs::copy(&dest, &safety).map_err(|e| {
      let _ = std::fs::remove_file(&staged);
      format!("Cannot keep a safety copy of the current database: {e}")
    })?;
  }
  for suffix in ["", "-wal", "-shm"] {
    let _ = std::fs::remove_file(format!("{}{}", dest.display(), suffix));
  }
  let result = std::fs::copy(&staged, &dest).map_err(|e| {
    format!("Cannot install the backup (the previous database is kept as estate.db.pre-restore.bak): {e}")
  });
  let _ = std::fs::remove_file(&staged);
  result?;
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let migrations = vec![
    Migration {
      version: 1,
      description: "create initial schema",
      sql: include_str!("../migrations/0001_init.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 2,
      description: "record buyer and formalin weights on sales",
      sql: include_str!("../migrations/0002_sale_weights.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 3,
      description: "photo on invoices and purchases",
      sql: include_str!("../migrations/0003_photos.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 4,
      description: "category on purchases",
      sql: include_str!("../migrations/0004_purchase_categories.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 5,
      description: "person on smokehouse movements",
      sql: include_str!("../migrations/0005_smokehouse_person.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 6,
      description: "record what an import created so it can be undone",
      sql: include_str!("../migrations/0006_import_undo.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 7,
      description: "a reason for a block that was not due to be tapped",
      sql: include_str!("../migrations/0007_not_scheduled_reason.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 8,
      description: "photo on vendor payments",
      sql: include_str!("../migrations/0008_vendor_payment_photo.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 9,
      description: "photo on buyer payments",
      sql: include_str!("../migrations/0009_buyer_payment_photo.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 10,
      description: "photos of the weekly and monthly statements",
      sql: include_str!("../migrations/0010_statement_photos.sql"),
      kind: MigrationKind::Up,
    },
    Migration {
      version: 11,
      description: "indexes on child-table foreign keys",
      sql: include_str!("../migrations/0011_child_table_indexes.sql"),
      kind: MigrationKind::Up,
    },
  ];

  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(
      tauri_plugin_sql::Builder::default()
        .add_migrations("sqlite:estate.db", migrations)
        .build(),
    )
    .invoke_handler(tauri::generate_handler![exec_tx, restore_database])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
