import * as readline from 'readline';
import { inspect } from 'util';

interface DebugContext {
  [key: string]: any;
}

/**
 * CLI Debugger - Similar to pdb.set_trace() in Python
 * Usage:
 *   import { breakpoint } from './debugger';
 *   breakpoint({ variable1, variable2 });
 *
 * Commands:
 *   c, continue  - Continue execution
 *   n, next      - Next line
 *   s, step      - Step into
 *   p <var>      - Print variable
 *   l, locals    - Show all local variables
 *   e <expr>     - Evaluate expression
 *   q, quit      - Quit debugger
 *   h, help      - Show help
 */
export async function breakpoint(context: DebugContext = {}, label: string = 'breakpoint'): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`\n🔴 DEBUGGER STOPPED at ${label}`);
  console.log('Type "help" for available commands\n');

  const showPrompt = () => {
    rl.question('(debug) ', async (input) => {
      const [cmd, ...args] = input.trim().split(' ');
      const arg = args.join(' ');

      switch (cmd.toLowerCase()) {
        case 'c':
        case 'continue':
          console.log('Continuing...\n');
          rl.close();
          return;

        case 'p':
        case 'print':
          if (arg) {
            try {
              if (arg in context) {
                console.log(inspect(context[arg], { depth: 3, colors: true }));
              } else {
                // Try to evaluate as expression
                const fn = new Function(...Object.keys(context), `return ${arg}`);
                const result = fn(...Object.values(context));
                console.log(inspect(result, { depth: 3, colors: true }));
              }
            } catch (e) {
              console.log(`Error: ${e}`);
            }
          } else {
            console.log('Usage: p <variable>');
          }
          break;

        case 'l':
        case 'locals':
          console.log('Local variables:');
          for (const [key, value] of Object.entries(context)) {
            const preview = typeof value === 'object'
              ? inspect(value, { depth: 1 }).substring(0, 50) + '...'
              : String(value).substring(0, 50);
            console.log(`  ${key} = ${preview}`);
          }
          break;

        case 'e':
        case 'eval':
          if (arg) {
            try {
              const fn = new Function(...Object.keys(context), `return ${arg}`);
              const result = fn(...Object.values(context));
              console.log(inspect(result, { depth: 3, colors: true }));
            } catch (e) {
              console.log(`Error: ${e}`);
            }
          } else {
            console.log('Usage: e <expression>');
          }
          break;

        case 'q':
        case 'quit':
          console.log('Quitting debugger...');
          process.exit(0);

        case 'h':
        case 'help':
        default:
          console.log(`
Commands:
  c, continue     Continue execution
  p, print <var>  Print variable value
  l, locals       Show all local variables
  e, eval <expr>  Evaluate expression
  q, quit         Quit debugger
  h, help         Show this help
`);
          break;
      }

      showPrompt();
    });
  };

  showPrompt();

  // Wait for rl to close
  await new Promise<void>((resolve) => {
    rl.on('close', resolve);
  });
}

/**
 * Quick breakpoint that pauses and shows context
 * Usage: pause({ variable1, variable2 });
 */
export function pause(context: DebugContext = {}): void {
  console.log('\n⏸️  PAUSED - Press Enter to continue...');
  console.log('Context:', Object.keys(context).join(', '));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('', () => {
    rl.close();
  });
}

/**
 * Conditional breakpoint
 * Usage:
 *   if (debug.when(user.id === 123)) {
 *     breakpoint({ user });
 *   }
 */
export const debug = {
  when: (condition: boolean): boolean => condition,

  log: (label: string, data: any): void => {
    console.log(`[DEBUG ${label}]:`, inspect(data, { depth: 2, colors: true }));
  }
};
