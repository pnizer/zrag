import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { RagConfig, RagConfigSchema, DefaultConfig } from '../../types/config.js';

export class ConfigManager {
  private configPath: string;
  private configDir: string;

  constructor(customPath?: string) {
    this.configDir = this.resolveConfigPath(customPath);
    this.configPath = path.join(this.configDir, 'config.json');
  }

  /**
   * Resolve configuration path with cross-platform support
   */
  private resolveConfigPath(customPath?: string): string {
    if (customPath) {
      return customPath;
    }

    if (process.env['RAG_CONFIG_PATH']) {
      return process.env['RAG_CONFIG_PATH'];
    }

    // Default to user home directory
    const homeDir = os.homedir();
    return path.join(homeDir, '.rag-tool');
  }

  /**
   * Get the database file path
   */
  getDatabasePath(): string {
    return path.join(this.configDir, 'database.db');
  }

  /**
   * Get the configuration directory path
   */
  getConfigDir(): string {
    return this.configDir;
  }

  /**
   * Get the configuration file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Check if configuration exists
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure configuration directory exists
   */
  async ensureConfigDir(): Promise<void> {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create config directory: ${String(error)}`);
    }
  }

  /**
   * Load configuration from file
   */
  async load(): Promise<RagConfig> {
    try {
      const configData = await fs.readFile(this.configPath, 'utf-8');
      const parsedConfig = JSON.parse(configData);
      
      // Validate and merge with defaults
      const config = RagConfigSchema.parse({
        ...DefaultConfig,
        ...parsedConfig,
        database: {
          ...DefaultConfig.database,
          path: this.getDatabasePath(),
          ...parsedConfig.database,
        },
      });

      return config;
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') {
        throw new Error('Configuration file not found. Run "rag-tool init" first.');
      }
      throw new Error(`Failed to load configuration: ${String(error)}`);
    }
  }

  /**
   * Save configuration to file
   */
  async save(config: RagConfig): Promise<void> {
    try {
      await this.ensureConfigDir();
      
      // Remove database path from saved config (it's calculated dynamically)
      const configToSave = {
        ...config,
        database: {
          ...config.database,
          path: undefined,
        },
      };

      const configData = JSON.stringify(configToSave, null, 2);
      await fs.writeFile(this.configPath, configData, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save configuration: ${String(error)}`);
    }
  }

  /**
   * Validate configuration
   */
  async validate(config: unknown): Promise<RagConfig> {
    try {
      return RagConfigSchema.parse(config);
    } catch (error) {
      throw new Error(`Configuration validation failed: ${String(error)}`);
    }
  }

  /**
   * Create default configuration
   */
  createDefault(): RagConfig {
    return RagConfigSchema.parse({
      ...DefaultConfig,
      database: {
        ...DefaultConfig.database,
        path: this.getDatabasePath(),
      },
    });
  }

  /**
   * Update configuration partially
   */
  async update(updates: Partial<RagConfig>): Promise<RagConfig> {
    const currentConfig = await this.load();
    const updatedConfig = {
      ...currentConfig,
      ...updates,
    };
    
    const validatedConfig = await this.validate(updatedConfig);
    await this.save(validatedConfig);
    return validatedConfig;
  }
}