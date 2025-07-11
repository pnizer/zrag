import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { RagConfig, RagConfigSchema, DefaultConfig } from '../types/config.js';
import { ValidationError, FileError } from './errors.js';

export class ConfigManager {
  private configPath: string;
  private configDir: string;

  constructor(customPath?: string) {
    if (customPath) {
      this.configPath = path.resolve(customPath);
      this.configDir = path.dirname(this.configPath);
    } else {
      this.configDir = this.getDefaultConfigDir();
      this.configPath = path.join(this.configDir, 'config.json');
    }
  }

  /**
   * Get default configuration directory
   */
  private getDefaultConfigDir(): string {
    const homeDir = os.homedir();
    return path.join(homeDir, '.rag-tool');
  }

  /**
   * Get default database path
   */
  getDefaultDatabasePath(): string {
    return path.join(this.configDir, 'database.db');
  }

  /**
   * Check if configuration file exists
   */
  exists(): boolean {
    try {
      return require('fs').existsSync(this.configPath);
    } catch {
      return false;
    }
  }

  /**
   * Load configuration from file
   */
  async load(): Promise<RagConfig> {
    try {
      if (!this.exists()) {
        throw new FileError('Configuration file not found. Run "rag-tool init" to create one.');
      }

      const content = await fs.readFile(this.configPath, 'utf-8');
      const data = JSON.parse(content);
      
      // Validate against schema
      const result = RagConfigSchema.safeParse(data);
      if (!result.success) {
        throw new ValidationError(`Invalid configuration: ${result.error.message}`);
      }

      // Set default database path if not specified
      if (!result.data.database.path) {
        result.data.database.path = this.getDefaultDatabasePath();
      }

      return result.data;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ValidationError('Configuration file contains invalid JSON');
      }
      if (error instanceof ValidationError || error instanceof FileError) {
        throw error;
      }
      throw new FileError(`Failed to load configuration: ${String(error)}`);
    }
  }

  /**
   * Save configuration to file
   */
  async save(config: Partial<RagConfig>): Promise<void> {
    try {
      // Ensure config directory exists
      await fs.mkdir(this.configDir, { recursive: true });

      // Merge with defaults
      const fullConfig = {
        ...DefaultConfig,
        ...config,
        database: {
          ...DefaultConfig.database,
          ...config.database,
          path: config.database?.path || this.getDefaultDatabasePath(),
        },
      };

      // Validate against schema
      const result = RagConfigSchema.safeParse(fullConfig);
      if (!result.success) {
        throw new ValidationError(`Invalid configuration: ${result.error.message}`);
      }

      // Write to file
      const content = JSON.stringify(result.data, null, 2);
      await fs.writeFile(this.configPath, content, 'utf-8');
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new FileError(`Failed to save configuration: ${String(error)}`);
    }
  }

  /**
   * Get configuration file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Get configuration directory
   */
  getConfigDir(): string {
    return this.configDir;
  }

  /**
   * Update specific configuration values
   */
  async update(updates: Partial<RagConfig>): Promise<void> {
    const currentConfig = await this.load();
    const updatedConfig = this.mergeDeep(currentConfig, updates);
    await this.save(updatedConfig);
  }

  /**
   * Reset configuration to defaults
   */
  async reset(): Promise<void> {
    await this.save(DefaultConfig);
  }

  /**
   * Delete configuration file
   */
  async delete(): Promise<void> {
    try {
      if (this.exists()) {
        await fs.unlink(this.configPath);
      }
    } catch (error) {
      throw new FileError(`Failed to delete configuration: ${String(error)}`);
    }
  }

  /**
   * Validate configuration without loading
   */
  async validate(): Promise<{ valid: boolean; errors: string[] }> {
    try {
      await this.load();
      return { valid: true, errors: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { valid: false, errors: [message] };
    }
  }

  /**
   * Get configuration info
   */
  getInfo(): {
    configPath: string;
    configDir: string;
    exists: boolean;
    databasePath: string;
  } {
    return {
      configPath: this.configPath,
      configDir: this.configDir,
      exists: this.exists(),
      databasePath: this.getDefaultDatabasePath(),
    };
  }

  /**
   * Deep merge two objects
   */
  private mergeDeep(target: any, source: any): any {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.mergeDeep(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }
}