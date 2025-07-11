import { createInterface } from 'readline';

export async function promptUser(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function promptSecure(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    process.stdout.write(question);
    
    // Hide input for secure fields
    process.stdin.setRawMode(true);
    process.stdin.resume();
    
    let input = '';
    
    const onData = (char: Buffer) => {
      const c = char.toString();
      
      switch (c) {
        case '\n':
        case '\r':
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(input);
          break;
        case '\u0003': // Ctrl+C
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          rl.close();
          process.exit(1);
        case '\u007f': // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
          break;
        default:
          if (c >= ' ' && c <= '~') { // Printable characters
            input += c;
            process.stdout.write('*');
          }
          break;
      }
    };
    
    process.stdin.on('data', onData);
  });
}

export async function promptConfirm(question: string, defaultValue: boolean = false): Promise<boolean> {
  const defaultText = defaultValue ? 'Y/n' : 'y/N';
  const answer = await promptUser(`${question} (${defaultText}): `);
  
  if (answer.length === 0) {
    return defaultValue;
  }
  
  return answer.toLowerCase().startsWith('y');
}

export async function promptChoice<T>(
  question: string,
  choices: Array<{ label: string; value: T; description?: string }>,
  defaultIndex?: number
): Promise<T> {
  console.log(question);
  console.log('');
  
  choices.forEach((choice, index) => {
    const marker = index === defaultIndex ? '●' : '○';
    const description = choice.description ? ` - ${choice.description}` : '';
    console.log(`  ${marker} ${index + 1}. ${choice.label}${description}`);
  });
  
  console.log('');
  
  while (true) {
    const answer = await promptUser('Enter your choice (number): ');
    
    if (answer === '' && defaultIndex !== undefined) {
      return choices[defaultIndex]!.value;
    }
    
    const choiceIndex = parseInt(answer) - 1;
    
    if (choiceIndex >= 0 && choiceIndex < choices.length) {
      return choices[choiceIndex]!.value;
    }
    
    console.log(`Please enter a number between 1 and ${choices.length}`);
  }
}