const categories = [
  "Advertising",
  "Meals",
  "Office supplies",
  "Software",
  "Travel",
  "Utilities",
  "Other"
];

const form = document.querySelector("#expense-form");
const descriptionInput = document.querySelector("#description");
const merchantInput = document.querySelector("#merchant");
const amountInput = document.querySelector("#amount");
const dateInput = document.querySelector("#date");
const categoryInput = document.querySelector("#category");
const categoryHelp = document.querySelector("#category-help");
const formError = document.querySelector("#form-error");
const saveButton = document.querySelector("#save-button");
const modelStatus = document.querySelector("#model-status");
const ledger = document.querySelector("#ledger");
const totals = document.querySelector("#totals");

let modelReady = false;

dateInput.value = localDateInputValue(new Date());

function localDateInputValue(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatAmount(value) {
  return `$${Number(value).toFixed(2)}`;
}

function formatDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function showFormError(message) {
  formError.hidden = !message;
  formError.textContent = message || "";
}

function setModelStatus(kind, title, detail) {
  modelStatus.className = `status status-${kind}`;
  modelStatus.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = title;
  modelStatus.append(heading, document.createTextNode(detail));
}

function applyModelState(ready) {
  modelReady = ready;
  const placeholder = categoryInput.querySelector('option[value=""]');
  if (ready) {
    categoryInput.required = false;
    if (placeholder) placeholder.hidden = false;
    categoryHelp.textContent = "The local model will suggest a category. A choice here is used only if Ollama cannot be reached.";
  } else {
    categoryInput.required = true;
    if (placeholder) placeholder.hidden = true;
    if (!categoryInput.value) categoryInput.value = "Other";
    categoryHelp.textContent = "Ollama is not available. Choose a category so this expense can still be saved.";
  }
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "The request could not be completed.");
  }
  return payload;
}

async function loadStatus() {
  setModelStatus("loading", "Checking the local model", "Asking Ollama whether it can categorize expenses.");
  try {
    const status = await readJson(await fetch("/api/status"));
    if (status.ready) {
      setModelStatus("ready", "Local model is ready", status.message || `${status.model} can suggest categories.`);
      applyModelState(true);
    } else {
      setModelStatus("down", "Local model is offline", status.message || "Choose a category yourself.");
      applyModelState(false);
    }
  } catch (error) {
    setModelStatus("down", "Local model could not be checked", error.message);
    applyModelState(false);
  }
}

function renderTotals(expenses) {
  const sum = expenses.reduce((total, expense) => total + Number(expense.amount || 0), 0);
  const count = expenses.length;
  totals.textContent = count === 0
    ? "Nothing recorded yet"
    : `${count} ${count === 1 ? "expense" : "expenses"} · ${formatAmount(sum)}`;
}

function renderLedger(expenses) {
  ledger.replaceChildren();
  renderTotals(expenses);
  if (expenses.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    const title = document.createElement("h3");
    title.textContent = "No expenses yet";
    const copy = document.createElement("p");
    copy.textContent = "Add a description, amount, and date. If the local model is offline, pick a category and it will still be saved here.";
    empty.append(title, copy);
    ledger.append(empty);
    return;
  }

  for (const expense of expenses) {
    const item = document.createElement("article");
    item.className = "expense";

    const top = document.createElement("div");
    top.className = "expense-top";
    const title = document.createElement("h3");
    title.textContent = expense.description;
    const amount = document.createElement("p");
    amount.className = "amount";
    amount.textContent = formatAmount(expense.amount);
    top.append(title, amount);

    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = [expense.merchant, formatDate(expense.date)].filter(Boolean).join(" · ");

    const badges = document.createElement("div");
    badges.className = "badges";
    const category = document.createElement("span");
    category.className = "badge";
    category.textContent = expense.category;
    const source = document.createElement("span");
    source.className = expense.manual ? "badge manual" : "badge model";
    source.textContent = expense.manual ? "You chose this" : "Model suggestion";
    badges.append(category, source);

    const note = document.createElement("p");
    note.className = "note";
    note.textContent = expense.note || "";

    const actions = document.createElement("div");
    actions.className = "expense-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => removeExpense(expense.id, remove));
    actions.append(remove);

    item.append(top, meta, badges, note, actions);
    ledger.append(item);
  }
}

function renderLedgerMessage(title, copy, isError) {
  totals.textContent = isError ? "Totals unavailable" : "Loading totals…";
  ledger.replaceChildren();
  const state = document.createElement("div");
  state.className = isError ? "state error" : "state";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = copy;
  state.append(heading, paragraph);
  if (isError) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "ghost";
    retry.textContent = "Try again";
    retry.addEventListener("click", loadExpenses);
    state.append(retry);
  }
  ledger.append(state);
}

async function loadExpenses() {
  renderLedgerMessage("Loading your ledger", "Reading expenses saved on this computer.", false);
  try {
    const expenses = await readJson(await fetch("/api/expenses"));
    if (!Array.isArray(expenses)) {
      throw new Error("The ledger did not come back as a list.");
    }
    renderLedger(expenses);
  } catch (error) {
    renderLedgerMessage("The ledger could not be loaded", error.message, true);
  }
}

async function removeExpense(id, button) {
  button.disabled = true;
  button.textContent = "Removing…";
  showFormError("");
  try {
    await readJson(await fetch(`/api/expenses/${id}`, { method: "DELETE" }));
    await loadExpenses();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Remove";
    showFormError(error.message);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showFormError("");

  const description = descriptionInput.value.trim();
  const merchant = merchantInput.value.trim();
  const amount = amountInput.value.trim();
  const date = dateInput.value;
  const category = categoryInput.value;

  if (!description || description.length > 500) {
    showFormError("Add a description of up to 500 characters.");
    descriptionInput.focus();
    return;
  }
  if (merchant.length > 100) {
    showFormError("Merchant must be 100 characters or fewer.");
    merchantInput.focus();
    return;
  }
  if (!/^\d+(?:\.\d+)?$/.test(amount)) {
    showFormError("Enter an amount greater than 0 and no more than 1,000,000,000.");
    amountInput.focus();
    return;
  }
  if (!date) {
    showFormError("Enter a valid expense date.");
    dateInput.focus();
    return;
  }
  if (!modelReady && !categories.includes(category)) {
    showFormError("Choose a category. The local model is not available to suggest one.");
    categoryInput.focus();
    return;
  }

  const payload = { description, merchant, amount, date };
  if (categories.includes(category)) payload.category = category;

  saveButton.disabled = true;
  saveButton.textContent = "Saving…";
  try {
    await readJson(await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }));
    descriptionInput.value = "";
    merchantInput.value = "";
    amountInput.value = "";
    showFormError("");
    await loadExpenses();
    descriptionInput.focus();
  } catch (error) {
    showFormError(error.message);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save expense";
  }
});

loadStatus();
loadExpenses();
