import { DatabaseService } from '../services/database.js';
import { DatabaseError } from './errors.js';

interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseService) => void;
  down?: (db: DatabaseService) => void;
}

export class MigrationManager {
  private db: DatabaseService;
  private migrations: Migration[] = [];

  constructor(db: DatabaseService) {
    this.db = db;
    this.initializeMigrations();
  }

  private initializeMigrations(): void {
    // Initial schema migration
    this.migrations.push({
      version: 1,
      name: 'initial_schema',
      up: (db: DatabaseService) => {
        // Schema is created in DatabaseService.createTables()
        // This migration just ensures the version is tracked
        const dbInstance = db.getDb();
        dbInstance.exec(`
          CREATE TABLE IF NOT EXISTS migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
      }
    });

    // Future migrations can be added here
    // Example:
    // this.migrations.push({
    //   version: 2,
    //   name: 'add_vector_index',
    //   up: (db: DatabaseService) => {
    //     const dbInstance = db.getDb();
    //     dbInstance.exec(`
    //       CREATE VIRTUAL TABLE IF NOT EXISTS vector_index USING vss0(
    //         embedding(1536),
    //         chunk_id INTEGER
    //       )
    //     `);
    //   }
    // });
  }

  /**
   * Get current schema version
   */
  getCurrentVersion(): number {
    try {
      const dbInstance = this.db.getDb();
      
      // Create migrations table if it doesn't exist
      dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      const stmt = dbInstance.prepare('SELECT MAX(version) as version FROM migrations');
      const result = stmt.get() as { version: number | null };
      return result.version || 0;
    } catch (error) {
      throw new DatabaseError(`Failed to get current version: ${String(error)}`);
    }
  }

  /**
   * Get latest available version
   */
  getLatestVersion(): number {
    return Math.max(...this.migrations.map(m => m.version), 0);
  }

  /**
   * Check if migrations are needed
   */
  needsMigration(): boolean {
    return this.getCurrentVersion() < this.getLatestVersion();
  }

  /**
   * Run pending migrations
   */
  migrate(): void {
    const currentVersion = this.getCurrentVersion();
    const pendingMigrations = this.migrations.filter(m => m.version > currentVersion);
    
    if (pendingMigrations.length === 0) {
      return;
    }

    try {
      this.db.transaction(() => {
        for (const migration of pendingMigrations.sort((a, b) => a.version - b.version)) {
          console.log(`Running migration ${migration.version}: ${migration.name}`);
          
          migration.up(this.db);
          
          // Record migration as applied
          const dbInstance = this.db.getDb();
          const stmt = dbInstance.prepare('INSERT INTO migrations (version, name) VALUES (?, ?)');
          stmt.run(migration.version, migration.name);
        }
      });
      
      console.log(`Database migrated to version ${this.getCurrentVersion()}`);
    } catch (error) {
      throw new DatabaseError(`Migration failed: ${String(error)}`);
    }
  }

  /**
   * Rollback to a specific version (if down migrations are provided)
   */
  rollback(targetVersion: number): void {
    const currentVersion = this.getCurrentVersion();
    
    if (targetVersion >= currentVersion) {
      throw new DatabaseError('Target version must be lower than current version');
    }

    const migrationsToRollback = this.migrations
      .filter(m => m.version > targetVersion && m.version <= currentVersion && m.down)
      .sort((a, b) => b.version - a.version); // Rollback in reverse order

    if (migrationsToRollback.length === 0) {
      throw new DatabaseError('No rollback migrations available');
    }

    try {
      this.db.transaction(() => {
        for (const migration of migrationsToRollback) {
          console.log(`Rolling back migration ${migration.version}: ${migration.name}`);
          
          migration.down!(this.db);
          
          // Remove migration record
          const dbInstance = this.db.getDb();
          const stmt = dbInstance.prepare('DELETE FROM migrations WHERE version = ?');
          stmt.run(migration.version);
        }
      });
      
      console.log(`Database rolled back to version ${this.getCurrentVersion()}`);
    } catch (error) {
      throw new DatabaseError(`Rollback failed: ${String(error)}`);
    }
  }
}