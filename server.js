import express from "express";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(root, "data");
const dataFile = path.join(dataDirectory, "expenses.json");
const port = Number(process.env.PORT) || 3000;
const ollamaUrl = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const model = process.env.OLLAMA_MODEL || "qwen2.5:3b";
const categories = [
  "Advertising",
  "Meals",
  "Office supplies",
  "Software",
  "Travel",
  "Utilities",
  "Other"
];

function isSameModel(installed, wanted) {
  if (typeof installed !== "string" || typeof wanted !== "string" || !installed || !wanted) {
    return false;
  }
  const withoutDefaultTag = (name) => name.endsWith(":latest") ? name.slice(0, -":latest".length) : name;
  return withoutDefaultTag(installed) === withoutDefaultTag(wanted);
}

function parseAmount(amount) {
  if (typeof amount === "number") {
    return amount;
  }
  if (typeof amount !== "string" || !/^\d+(?:\.\d+)?$/.test(amount.trim())) {
    return Number.NaN;
  }
  return Number(amount.trim());
}

const app = express();
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(root, "public")));

async function readExpenses() {
  try {
    const contents = await readFile(dataFile, "utf8");
    const expenses = JSON.parse(contents);
    if (!Array.isArray(expenses)) {
      throw new Error("Expense data must be a JSON array.");
    }
    return expenses;
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

let writeQueue = Promise.resolve();

function updateExpenses(update) {
  const task = writeQueue.then(async () => {
    const expenses = await readExpenses();
    const nextExpenses = update(expenses);
    const temporaryFile = path.join(dataDirectory, `.expenses-${randomUUID()}.tmp`);
    await writeFile(temporaryFile, `${JSON.stringify(nextExpenses, null, 2)}\n`, "utf8");
    await rename(temporaryFile, dataFile);
    return nextExpenses;
  });
  writeQueue = task.catch((error) => {
    console.error("Could not save local expense data:", error);
  });
  return task;
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day;
}

async function categorizeExpense({ description, merchant }) {
  let response;
  try {
    response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model,
        stream: false,
        format: {
          type: "object",
          properties: {
            category: { type: "string", enum: categories },
            note: { type: "string" }
          },
          required: ["category", "note"],
          additionalProperties: false
        },
        messages: [
          {
            role: "system",
            content: "Classify a freelancer's business expense using only the provided details. " +
              "Choose the closest category from the allowed list. If uncertain, choose Other. " +
              "Give one brief, plain-language reason. Do not give tax or legal advice. Return only the requested JSON."
          },
          {
            role: "user",
            content: JSON.stringify({ description, merchant, allowedCategories: categories })
          }
        ],
        options: { temperature: 0.1 }
      })
    });
  } catch (error) {
    const message = error.name === "TimeoutError"
      ? "The local model took too long to respond. Try again or use a smaller model."
      : `Cannot reach Ollama at ${ollamaUrl}. Start Ollama and try again.`;
    throw Object.assign(new Error(message), { status: 503 });
  }

  if (!response.ok) {
    const details = await response.text();
    if (response.status === 404) {
      throw Object.assign(new Error(`Ollama could not find model "${model}". Run: ollama pull ${model}`), {
        status: 503
      });
    }
    throw Object.assign(new Error(`Ollama returned ${response.status}: ${details.slice(0, 300)}`), {
      status: 502
    });
  }

  const result = await response.json();
  let classification;
  try {
    const content = result?.message?.content;
    classification = JSON.parse(typeof content === "string" ? content : "");
  } catch {
    throw Object.assign(new Error("The local model returned invalid JSON. Please try again."), {
      status: 502
    });
  }

  if (!classification || typeof classification !== "object" || Array.isArray(classification) ||
      !categories.includes(classification.category) || typeof classification.note !== "string") {
    throw Object.assign(new Error("The local model returned an invalid expense category. Please try again."), {
      status: 502
    });
  }

  return {
    category: classification.category,
    note: classification.note.trim().slice(0, 240)
  };
}

app.get("/api/status", async (_request, response) => {
  try {
    const ollamaResponse = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(3_000)
    });
    if (!ollamaResponse.ok) {
      return response.json({ ready: false, message: "Ollama is running but could not be checked." });
    }
    const payload = await ollamaResponse.json();
    const models = Array.isArray(payload?.models) ? payload.models : [];
    const modelAvailable = models.some((item) =>
      isSameModel(item?.name, model) || isSameModel(item?.model, model)
    );
    response.json({
      ready: modelAvailable,
      model,
      message: modelAvailable ? "Local AI is ready" : `Run "ollama pull ${model}" to get started.`
    });
  } catch {
    response.json({
      ready: false,
      model,
      message: `Start Ollama, then run "ollama pull ${model}".`
    });
  }
});

app.get("/api/expenses", async (_request, response, next) => {
  try {
    await writeQueue;
    response.json(await readExpenses());
  } catch (error) {
    next(error);
  }
});

app.post("/api/expenses", async (request, response, next) => {
  const { description, merchant = "", amount, date } = request.body || {};
  if (typeof description !== "string" || !description.trim() || description.trim().length > 500) {
    return response.status(400).json({ error: "Add a description of up to 500 characters." });
  }
  if (typeof merchant !== "string" || merchant.trim().length > 100) {
    return response.status(400).json({ error: "Merchant must be 100 characters or fewer." });
  }
  const numericAmount = parseAmount(amount);
  const roundedAmount = Math.round(numericAmount * 100) / 100;
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 1_000_000_000 || roundedAmount <= 0) {
    return response.status(400).json({ error: "Enter an amount greater than 0 and no more than 1,000,000,000." });
  }
  if (!isValidDate(date)) {
    return response.status(400).json({ error: "Enter a valid expense date." });
  }

  const chosenCategory = request.body?.category;
  let classification;
  try {
    classification = await categorizeExpense({
      description: description.trim(),
      merchant: merchant.trim()
    });
  } catch (error) {
    if (error?.status === 503 && categories.includes(chosenCategory)) {
      classification = {
        category: chosenCategory,
        note: "You chose this category because the local model was unavailable.",
        manual: true
      };
    } else {
      next(error);
      return;
    }
  }

  try {
    const expense = {
      id: randomUUID(),
      description: description.trim(),
      merchant: merchant.trim(),
      amount: roundedAmount,
      date,
      ...classification,
      createdAt: new Date().toISOString()
    };
    const expenses = await updateExpenses((current) => [expense, ...current]);
    response.status(201).json({ expense, total: expenses.length });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/expenses/:id", async (request, response, next) => {
  try {
    const expenses = await updateExpenses((current) =>
      current.filter((expense) => expense.id !== request.params.id)
    );
    response.json({ total: expenses.length });
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  console.error("Request failed:", error);
  response.status(status).json({
    error: status === 500 || !error?.message
      ? "The request could not be completed."
      : error.message
  });
});

await mkdir(dataDirectory, { recursive: true });
app.listen(port, "0.0.0.0", () => {
  console.log(`Pocket Ledger is listening on 0.0.0.0:${port}`);
  console.log(`Local model: ${model} via ${ollamaUrl}`);
});
