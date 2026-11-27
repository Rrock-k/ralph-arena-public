import chalk from 'chalk';

const timestamp = () => {
  return chalk.gray(`[${new Date().toISOString().slice(11, 19)}]`);
};

export const log = {
  info: (message: string) => {
    console.log(`${timestamp()} ${chalk.blue('INFO')} ${message}`);
  },
  
  success: (message: string) => {
    console.log(`${timestamp()} ${chalk.green('SUCCESS')} ${message}`);
  },
  
  warn: (message: string) => {
    console.log(`${timestamp()} ${chalk.yellow('WARN')} ${message}`);
  },
  
  error: (message: string) => {
    console.log(`${timestamp()} ${chalk.red('ERROR')} ${message}`);
  },
  
  debug: (message: string) => {
    if (process.env.DEBUG) {
      console.log(`${timestamp()} ${chalk.gray('DEBUG')} ${message}`);
    }
  },
  
  iteration: (num: number, taskId?: string) => {
    console.log('');
    console.log(chalk.cyan('═'.repeat(60)));
    const suffix = taskId ? ` - ${taskId}` : '';
    console.log(chalk.cyan(`  ITERATION ${num}${suffix}`));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log('');
  },
  
  state: (state: string) => {
    console.log(`${timestamp()} ${chalk.magenta('STATE')} → ${state}`);
  },
  
  agent: (name: string, message: string) => {
    console.log(`${timestamp()} ${chalk.yellow(`[${name}]`)} ${message}`);
  },
  
  divider: () => {
    console.log(chalk.gray('─'.repeat(60)));
  },
  
  box: (title: string, content: string) => {
    console.log('');
    console.log(chalk.cyan(`┌─ ${title} ${'─'.repeat(Math.max(0, 55 - title.length))}┐`));
    content.split('\n').forEach(line => {
      console.log(chalk.cyan('│ ') + line);
    });
    console.log(chalk.cyan('└' + '─'.repeat(58) + '┘'));
    console.log('');
  },
};

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
