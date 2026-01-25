# Freedom CLI

## An Advanced Command-Line Interface for AI Agents and Multi-Modal Communication

Freedom CLI is a powerful and extensible command-line interface designed to facilitate interaction with various AI models, agents, and multi-modal communication protocols (MCP). It provides a flexible framework for building, integrating, and experimenting with AI-powered tools and workflows directly from your terminal.

## Features

-   **AI Provider Integrations:** Seamlessly connect with different AI models (e.g., LM Studio, DeepSeek, Anthropic, Google AI) through a unified interface.
-   **Agent System:** Develop and deploy intelligent agents that can automate tasks, respond to queries, and manage complex workflows.
-   **Multi-Modal Communication Protocol (MCP):** Support for advanced communication protocols enabling interaction with external services and tools.
-   **Pluggable Architecture:** Extend functionality with custom plugins, tools, and skills to tailor the CLI to your specific needs.
-   **Context Management:** Advanced features for managing conversation context, history, and session state.
-   **Interactive Terminal Experience:** A rich and responsive command-line environment for efficient interaction.

## Installation

To get started with Freedom CLI, follow these steps:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/freedom-cli.git
    cd freedom-cli
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Build the project:**
    ```bash
    npm run build
    ```

## Configuration

Freedom CLI uses a `config.json` file (typically located in `~/.freedom-cli/config.json`) for persistent settings. Sensitive information, such as API keys, should be stored in a `.env` file in the project root.

Example `.env` file:
```
GOOGLE_API_KEY=your_google_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
DEEPSEEK_API_KEY=your_deepseek_api_key
# Add other API keys as needed
```

## Usage

After installation and configuration, you can run the CLI:

```bash
npm start
```

Once inside the CLI, you can interact with it using various commands. Here are a few examples (actual commands may vary and can be discovered within the CLI):

-   **Chat with an AI model:**
    ```
    /chat "Tell me a story about a talking cat."
    ```
-   **List available agents:**
    ```
    /agents list
    ```
-   **Use a tool:**
    ```
    /tool use <tool_name> <arguments>
    ```
-   **Manage context:**
    ```
    /clear
    /history
    ```
-   **Change AI model:**
    ```
    /model deepseek-chat
    ```

For a comprehensive guide on all commands and features, please refer to the [User Guide](docs/USER_GUIDE.md).

## Development

To contribute to Freedom CLI or run tests:

1.  Ensure you have Node.js and npm installed.
2.  Follow the installation and build steps above.
3.  Run tests: (Please refer to `package.json` for specific test commands, e.g., `npm test`)

## Contributing

We welcome contributions! Please see our `CONTRIBUTING.md` (if available) for guidelines on how to submit pull requests, report issues, and more.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.

## Support

If you encounter any issues or have questions, please open an issue on the GitHub repository.

---
**Note:** This `README.md` is a generated placeholder. Please review and update it with accurate and detailed information specific to your Freedom CLI project.
