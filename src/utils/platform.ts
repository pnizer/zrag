import os from 'os';
import path from 'path';

export interface PlatformInfo {
  platform: string;
  arch: string;
  extensionFile: string;
}

export class PlatformDetector {
  /**
   * Get current platform information
   */
  static getPlatformInfo(): PlatformInfo {
    const platform = os.platform();
    const arch = os.arch();
    
    return {
      platform,
      arch,
      extensionFile: this.getExtensionFilename(platform, arch)
    };
  }

  /**
   * Get the sqlite-vss extension filename for the current platform
   */
  private static getExtensionFilename(platform: string, arch: string): string {
    const normalizedArch = this.normalizeArch(arch);
    
    switch (platform) {
      case 'darwin':
        return `sqlite-vss-darwin-${normalizedArch}.dylib`;
      case 'linux':
        return `sqlite-vss-linux-${normalizedArch}.so`;
      case 'win32':
        return `sqlite-vss-win32-${normalizedArch}.dll`;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * Normalize architecture names to match our binary naming convention
   */
  private static normalizeArch(arch: string): string {
    switch (arch) {
      case 'x64':
      case 'x86_64':
        return 'x64';
      case 'arm64':
      case 'aarch64':
        return 'arm64';
      default:
        throw new Error(`Unsupported architecture: ${arch}`);
    }
  }

  /**
   * Get the expected path to the vector extension binary
   */
  static getExtensionPath(binariesDir: string): string {
    const platformInfo = this.getPlatformInfo();
    return path.join(binariesDir, platformInfo.extensionFile);
  }

  /**
   * Check if the current platform is supported
   */
  static isSupported(): boolean {
    try {
      this.getPlatformInfo();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get a human-readable platform description
   */
  static getPlatformDescription(): string {
    const { platform, arch } = this.getPlatformInfo();
    
    const platformNames: Record<string, string> = {
      'darwin': 'macOS',
      'linux': 'Linux',
      'win32': 'Windows'
    };
    
    const archNames: Record<string, string> = {
      'x64': 'x64',
      'arm64': 'ARM64'
    };
    
    return `${platformNames[platform] || platform} ${archNames[arch] || arch}`;
  }
}