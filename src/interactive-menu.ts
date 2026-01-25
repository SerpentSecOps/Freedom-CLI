/**
 * Interactive menu system with tabs and arrow key navigation
 * Supports ESC and Ctrl+C to exit, locks other keyboard inputs
 */

import readline from 'readline';
import chalk from 'chalk';

export interface MenuItem {
  label: string;
  value: string | boolean | number;
  type: 'toggle' | 'select' | 'input';
  options?: string[]; // For select type
  currentValue?: any;
}

export interface MenuTab {
  name: string;
  items: MenuItem[];
}

export interface MenuResult {
  [key: string]: any;
}

export class InteractiveMenu {
  private tabs: MenuTab[];
  private currentTabIndex: number = 0;
  private currentItemIndex: number = 0;
  private results: MenuResult = {};
  private rl: readline.Interface | null = null;

  constructor(tabs: MenuTab[]) {
    this.tabs = tabs;
    // Initialize results with current values
    tabs.forEach(tab => {
      tab.items.forEach(item => {
        this.results[item.label] = item.currentValue;
      });
    });
  }

  /**
   * Show the menu and handle keyboard navigation
   */
  async show(): Promise<MenuResult> {
    return new Promise((resolve, reject) => {
      // Set up raw mode for key capture
      if (process.stdin.isTTY) {
        readline.emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
      }

      // Initial render
      this.render();

      const onKeypress = (str: string, key: any) => {
        // Handle Ctrl+C
        if (key.ctrl && key.name === 'c') {
          this.cleanup();
          reject(new Error('Menu cancelled'));
          return;
        }

        // Handle ESC
        if (key.name === 'escape') {
          this.cleanup();
          reject(new Error('Menu cancelled'));
          return;
        }

        // Handle Tab (switch tabs)
        if (key.name === 'tab') {
          if (key.shift) {
            // Shift+Tab - previous tab
            this.currentTabIndex = (this.currentTabIndex - 1 + this.tabs.length) % this.tabs.length;
          } else {
            // Tab - next tab
            this.currentTabIndex = (this.currentTabIndex + 1) % this.tabs.length;
          }
          this.currentItemIndex = 0;
          this.render();
          return;
        }

        // Handle arrow keys
        if (key.name === 'up') {
          const currentTab = this.tabs[this.currentTabIndex];
          this.currentItemIndex = (this.currentItemIndex - 1 + currentTab.items.length) % currentTab.items.length;
          this.render();
          return;
        }

        if (key.name === 'down') {
          const currentTab = this.tabs[this.currentTabIndex];
          this.currentItemIndex = (this.currentItemIndex + 1) % currentTab.items.length;
          this.render();
          return;
        }

        // Handle Enter or Space (toggle/select)
        if (key.name === 'return' || key.name === 'space') {
          const currentTab = this.tabs[this.currentTabIndex];
          const currentItem = currentTab.items[this.currentItemIndex];

          if (currentItem.type === 'toggle') {
            // Toggle boolean value
            this.results[currentItem.label] = !this.results[currentItem.label];
            this.render();
          } else if (currentItem.type === 'select' && currentItem.options) {
            // Cycle through options
            const currentValue = this.results[currentItem.label];
            const currentIndex = currentItem.options.indexOf(currentValue);
            const nextIndex = (currentIndex + 1) % currentItem.options.length;
            this.results[currentItem.label] = currentItem.options[nextIndex];
            this.render();
          }
          return;
        }

        // Handle 's' or 'S' to save and exit
        if (key.name === 's') {
          this.cleanup();
          resolve(this.results);
          return;
        }
      };

      process.stdin.on('keypress', onKeypress);

      // Store cleanup reference
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    });
  }

  private cleanup() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.removeAllListeners('keypress');
    if (this.rl) {
      this.rl.close();
    }
    // Clear the menu
    console.clear();
  }

  private render() {
    console.clear();

    // Title
    console.log(chalk.bold.cyan('\n⚙️  Configuration Menu\n'));

    // Tabs
    console.log('  ' + this.tabs.map((tab, index) => {
      if (index === this.currentTabIndex) {
        return chalk.bgCyan.black.bold(` ${tab.name} `);
      } else {
        return chalk.gray(` ${tab.name} `);
      }
    }).join('  '));
    console.log('');

    // Current tab items
    const currentTab = this.tabs[this.currentTabIndex];
    currentTab.items.forEach((item, index) => {
      const isSelected = index === this.currentItemIndex;
      const prefix = isSelected ? chalk.cyan('❯') : ' ';

      let displayValue = '';
      if (item.type === 'toggle') {
        const toggleValue = this.results[item.label];
        displayValue = toggleValue ? chalk.green('ON') : chalk.red('OFF');
      } else if (item.type === 'select') {
        displayValue = chalk.white(this.results[item.label]);
      } else if (item.type === 'input') {
        displayValue = chalk.white(this.results[item.label]);
      }

      const labelColor = isSelected ? chalk.white.bold : chalk.gray;
      console.log(`  ${prefix} ${labelColor(item.label)}: ${displayValue}`);
    });

    // Instructions
    console.log('');
    console.log(chalk.gray('  ↑/↓: Navigate  Tab: Switch tabs  Enter/Space: Toggle/Select  S: Save  ESC: Cancel'));
    console.log('');
  }
}

/**
 * Create and show a configuration menu
 */
export async function showConfigMenu(autoCompact: boolean, compactMethod: string, contextLimit: number): Promise<MenuResult> {
  const tabs: MenuTab[] = [
    {
      name: 'General',
      items: [
        {
          label: 'autoCompact',
          value: autoCompact,
          type: 'toggle',
          currentValue: autoCompact,
        },
        {
          label: 'compactMethod',
          value: compactMethod,
          type: 'select',
          options: ['semantic', 'simple', 'smart'],
          currentValue: compactMethod,
        },
      ],
    },
    {
      name: 'Context',
      items: [
        {
          label: 'contextLimit',
          value: contextLimit,
          type: 'select',
          options: ['50000', '128000', '180000', '200000'],
          currentValue: contextLimit.toString(),
        },
      ],
    },
  ];

  const menu = new InteractiveMenu(tabs);
  return await menu.show();
}
