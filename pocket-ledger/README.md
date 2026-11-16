# Pocket Ledger

A tiny, local-first expense sorter for freelancers. Add an expense and an open-weight AI model assigns a category and gives a short explanation. Review spending totals, keep a local record, and remove entries when needed.

## Why open AI?

Pocket Ledger sends expense descriptions only to the Ollama service running on your own computer. The app does not call a hosted AI API, and the expense ledger is stored in `data/expenses.json` on that computer. That keeps client and business details out of another company's account, avoids per-request model fees, and lets you change the model with an environment variable. Once the model has been downloaded, categorization can run without an internet connection.

## Requirements

- Node.js 18 or newer
- [Ollama](https://ollama.com/) installed and running

## Run it

```sh
npm install
ollama pull qwen2.5:3b
npm start
```

Then visit [http://127.0.0.1:3000](http://127.0.0.1:3000).

Ollama is the only AI service used. The first model download requires an internet connection; after that, you can use the app offline while Ollama is running.

If Ollama is not running, or the model has not been pulled, choose a category in the form. The expense is still saved in `data/expenses.json`, and the ledger notes that you chose the category. Pocket Ledger does not download a model for you.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Express server port |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Local Ollama server URL |
| `OLLAMA_MODEL` | `qwen2.5:3b` | Installed Ollama model name |

For example, set `OLLAMA_MODEL` to another Ollama model that supports JSON-format output. The server listens on `0.0.0.0` and `PORT` (3000 when `PORT` is unset). On your own machine, open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Stack

- HTML, CSS, browser JavaScript
- Node.js and Express
- Qwen 2.5 3B through Ollama for local inference
- Local JSON file storage

The AI suggestion is an organizational aid, not tax or accounting advice. Check categories with your accountant before using them for filings.
