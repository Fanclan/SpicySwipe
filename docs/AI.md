# AI providers and drafts

AI is optional. Plain Like/pass sessions do not require a provider or API key.

## Cloud providers

Open **AI settings**, choose OpenAI, Gemini, Claude, or DeepSeek, enter your own key, select a discovered model or enter its API ID, and save. Test the connection, then try a draft. Model discovery checks listing access; generation can still fail because of model permissions, billing, or quota. Provider availability and pricing are controlled by the provider.

Review the selected text context before generation and enable the consent setting. Generated drafts remain editable. Automatic sending and Hinge AI comments are separate opt-ins. Bumble Compliments and automated messaging are not currently implemented.

## Ollama

1. Install and run [Ollama](https://docs.ollama.com/), and install a text/chat model appropriate for your machine.
2. Choose **Ollama** and use `http://localhost:11434` for a server on this computer.
3. Discover installed models and select one. Embedding-only models cannot generate drafts.
4. Save, test, and generate a draft with sample context first.

A different machine can host Ollama. Enter that server's root URL, without `/api`, credentials, query strings, or fragments. Configure networking using [Ollama's FAQ](https://docs.ollama.com/faq). Keep remote servers restricted to trusted clients; HTTP sends text without transport encryption. The Chrome extension requests access to the selected host.

## Storage and data

Desktop keys are encrypted through the OS secret-storage facilities. Extension keys are stored in the browser's local extension storage. The selected provider receives the text used for generation. Choosing a local Ollama server keeps that inference on your machine, but the dating apps themselves still communicate with their services. See [privacy](PRIVACY.md).
