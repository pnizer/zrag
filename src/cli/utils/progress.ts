export class ProgressIndicator {
  private spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private currentFrame = 0;
  private interval: NodeJS.Timeout | undefined;
  private message: string;

  constructor(message: string) {
    this.message = message;
  }

  start(): void {
    process.stdout.write('\x1B[?25l'); // Hide cursor
    this.interval = setInterval(() => {
      process.stdout.write(`\r${this.spinner[this.currentFrame]} ${this.message}`);
      this.currentFrame = (this.currentFrame + 1) % this.spinner.length;
    }, 100);
  }

  update(message: string): void {
    this.message = message;
  }

  stop(finalMessage?: string): void {
    if (this.interval !== undefined) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    process.stdout.write('\r\x1B[K'); // Clear line
    if (finalMessage) {
      console.log(`✅ ${finalMessage}`);
    }
    process.stdout.write('\x1B[?25h'); // Show cursor
  }

  fail(errorMessage?: string): void {
    if (this.interval !== undefined) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    process.stdout.write('\r\x1B[K'); // Clear line
    if (errorMessage) {
      console.log(`❌ ${errorMessage}`);
    }
    process.stdout.write('\x1B[?25h'); // Show cursor
  }
}

export class ProgressBar {
  private total: number;
  private current: number = 0;
  private width: number = 40;
  private message: string;

  constructor(total: number, message: string) {
    this.total = total;
    this.message = message;
  }

  update(current: number, message?: string): void {
    this.current = current;
    if (message) {
      this.message = message;
    }

    const percentage = Math.round((this.current / this.total) * 100);
    const filled = Math.round((this.current / this.total) * this.width);
    const empty = this.width - filled;

    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const line = `\r${this.message} [${bar}] ${percentage}% (${this.current}/${this.total})`;
    
    process.stdout.write(line);
  }

  finish(message?: string): void {
    this.update(this.total, message);
    process.stdout.write('\n');
  }
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}