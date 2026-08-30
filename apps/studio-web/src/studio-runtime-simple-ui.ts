const SIMPLE_CLASS = "runtime-simple-ui";
const ADVANCED_CLASS = "runtime-advanced-ui";
const STORAGE_KEY = "aistudio.runtime.chat-state.v1";

type ChatRole = "user" | "assistant";
type DrawerMode = "recent" | "archive";
type DetailPanel = "media" | "results" | null;

interface MediaAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
}

interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: number;
  media: MediaAttachment[];
}

interface ChatThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  favorite: boolean;
  archived: boolean;
  projectId: string | null;
  messages: ChatMessage[];
}

interface ChatProject {
  id: string;
  name: string;
  createdAt: number;
}

interface ChatState {
  activeChatId: string;
  chats: ChatThread[];
  projects: ChatProject[];
}

interface RuntimeChatResultDetail {
  chatId?: string;
  text?: string;
  media?: Array<Partial<MediaAttachment>>;
}

let advancedVisible = false;
let leftDrawerOpen = false;
let rightMenuOpen = false;
let drawerMode: DrawerMode = "recent";
let detailPanel: DetailPanel = null;
let projectPickerOpen = false;
let projectCreatorOpen = false;
let pendingFiles: File[] = [];
let state = loadState();

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createEmptyChat(): ChatThread {
  const now = Date.now();
  return {
    id: createId("chat"),
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    favorite: false,
    archived: false,
    projectId: null,
    messages: [],
  };
}

function defaultState(): ChatState {
  const chat = createEmptyChat();
  return { activeChatId: chat.id, chats: [chat], projects: [] };
}

function loadState(): ChatState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return defaultState();
    const parsed = JSON.parse(raw) as Partial<ChatState>;
    if (!Array.isArray(parsed.chats) || !Array.isArray(parsed.projects)) return defaultState();
    const chats = parsed.chats.filter((chat): chat is ChatThread => (
      typeof chat === "object" && chat !== null && typeof (chat as ChatThread).id === "string"
    ));
    const projects = parsed.projects.filter((project): project is ChatProject => (
      typeof project === "object" && project !== null && typeof (project as ChatProject).id === "string"
    ));
    if (chats.length === 0) return defaultState();
    const activeChatId = typeof parsed.activeChatId === "string" && chats.some((chat) => chat.id === parsed.activeChatId)
      ? parsed.activeChatId
      : chats[0].id;
    return { activeChatId, chats, projects };
  } catch {
    return defaultState();
  }
}

function saveState(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Runtime chat remains usable even when storage is unavailable.
  }
}

function activeChat(): ChatThread {
  let chat = state.chats.find((candidate) => candidate.id === state.activeChatId);
  if (chat === undefined) {
    chat = createEmptyChat();
    state.chats.push(chat);
    state.activeChatId = chat.id;
  }
  return chat;
}

function mediaFromFiles(files: File[]): MediaAttachment[] {
  return files.map((file) => ({
    id: createId("media"),
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
  }));
}

function chatTitle(prompt: string, files: File[]): string {
  const trimmed = prompt.trim();
  if (trimmed.length > 0) return trimmed.length > 44 ? `${trimmed.slice(0, 41)}…` : trimmed;
  if (files.length > 0) return files[0].name;
  return "New chat";
}

function ensureStyles(): void {
  if (document.querySelector("style[data-runtime-chat-ui-styles]") !== null) return;
  const style = document.createElement("style");
  style.dataset.runtimeChatUiStyles = "true";
  style.textContent = `
    [data-runtime-chat-shell] { display: none; }

    html.${SIMPLE_CLASS} body {
      margin: 0;
      min-height: 100vh;
      overflow: hidden;
      background: #090a0d;
      color: #f5f6f8;
    }

    html.${SIMPLE_CLASS} .studio-frame { display: none !important; }

    html.${SIMPLE_CLASS} [data-runtime-chat-shell] {
      display: grid;
      position: fixed;
      inset: 0;
      z-index: 60;
      grid-template-rows: 64px minmax(0, 1fr) auto;
      background: #090a0d;
      color: #f5f6f8;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    html.${ADVANCED_CLASS} [data-runtime-chat-shell] { display: none !important; }

    [data-runtime-chat-shell] button,
    [data-runtime-chat-shell] textarea,
    [data-runtime-chat-shell] input { font: inherit; }

    [data-runtime-chat-header] {
      display: grid;
      grid-template-columns: 1fr 48px;
      align-items: center;
      padding: max(8px, env(safe-area-inset-top)) 14px 6px 18px;
      border-bottom: 1px solid #17191f;
      background: rgba(9, 10, 13, .96);
      backdrop-filter: blur(18px);
    }

    [data-runtime-chat-title] {
      min-width: 0;
      overflow: hidden;
      color: #d7dae0;
      font-size: 14px;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    [data-runtime-chat-menu],
    [data-runtime-left-menu],
    [data-runtime-attach],
    [data-runtime-send] {
      min-width: 44px;
      min-height: 44px;
      border: 0;
      border-radius: 14px;
      background: transparent;
      color: #f3f4f6;
      cursor: pointer;
    }

    [data-runtime-chat-menu] {
      display: grid;
      place-items: center;
      font-size: 21px;
      letter-spacing: -4px;
    }

    [data-runtime-chat-main] {
      position: relative;
      overflow: auto;
      overscroll-behavior: contain;
      padding: 20px 16px 32px;
      scrollbar-width: thin;
    }

    [data-runtime-empty-chat] {
      display: grid;
      min-height: 100%;
      place-content: center;
      gap: 10px;
      padding: 0 20px 8vh;
      text-align: center;
    }

    [data-runtime-empty-chat] strong {
      font-size: clamp(28px, 8vw, 42px);
      font-weight: 520;
      letter-spacing: -.035em;
    }

    [data-runtime-empty-chat] span {
      color: #777f8d;
      font-size: 14px;
    }

    [data-runtime-message-list] {
      width: min(100%, 760px);
      margin: 0 auto;
      display: grid;
      gap: 18px;
      padding: 8px 0 24px;
    }

    [data-runtime-message] {
      display: grid;
      gap: 8px;
      max-width: 88%;
      padding: 12px 14px;
      border-radius: 18px;
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    [data-runtime-message="user"] {
      justify-self: end;
      background: #20242c;
      color: #f7f8fa;
    }

    [data-runtime-message="assistant"] {
      justify-self: start;
      background: #111319;
      color: #e5e7eb;
    }

    [data-runtime-message-media] {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 3px;
    }

    [data-runtime-media-chip] {
      display: inline-flex;
      max-width: 220px;
      min-height: 30px;
      align-items: center;
      gap: 6px;
      padding: 0 9px;
      border: 1px solid #343a45;
      border-radius: 9px;
      color: #bcc2cc;
      font-size: 11px;
    }

    [data-runtime-composer-wrap] {
      position: relative;
      padding: 8px 12px max(10px, env(safe-area-inset-bottom));
      background: linear-gradient(180deg, rgba(9,10,13,0), #090a0d 22%);
    }

    [data-runtime-pending-media] {
      display: none;
      width: min(100%, 760px);
      margin: 0 auto 7px;
      gap: 6px;
      overflow-x: auto;
      padding: 0 4px;
    }

    [data-runtime-pending-media][data-has-media="true"] { display: flex; }

    [data-runtime-pending-item] {
      display: inline-flex;
      flex: 0 0 auto;
      min-height: 34px;
      align-items: center;
      gap: 8px;
      padding: 0 8px 0 10px;
      border: 1px solid #303641;
      border-radius: 11px;
      background: #13161c;
      color: #cdd2da;
      font-size: 11px;
    }

    [data-runtime-pending-remove] {
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: #929aa8;
      cursor: pointer;
    }

    [data-runtime-composer] {
      display: grid;
      width: min(100%, 760px);
      min-height: 58px;
      margin: 0 auto;
      grid-template-columns: 46px minmax(0, 1fr) 46px;
      align-items: end;
      gap: 3px;
      padding: 6px;
      box-sizing: border-box;
      border: 1px solid #30343d;
      border-radius: 22px;
      background: #171a20;
      box-shadow: 0 10px 40px rgba(0,0,0,.28);
    }

    [data-runtime-attach] {
      display: grid;
      place-items: center;
      color: #d7dbe2;
      font-size: 25px;
      font-weight: 300;
    }

    [data-runtime-prompt] {
      width: 100%;
      max-height: 150px;
      min-height: 44px;
      box-sizing: border-box;
      resize: none;
      border: 0;
      outline: 0;
      padding: 11px 6px 8px;
      background: transparent;
      color: #f5f6f8;
      line-height: 1.4;
    }

    [data-runtime-prompt]::placeholder { color: #747b87; }

    [data-runtime-send] {
      display: grid;
      place-items: center;
      background: #f1f3f6;
      color: #0b0c0f;
      font-size: 19px;
    }

    [data-runtime-send]:disabled { opacity: .34; cursor: default; }

    [data-runtime-file-input] { display: none !important; }

    [data-runtime-overlay] {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 100;
      border: 0;
      background: rgba(0,0,0,.58);
      opacity: 0;
      pointer-events: none;
      transition: opacity 150ms ease;
    }

    html.${SIMPLE_CLASS}[data-runtime-left-open="true"] [data-runtime-overlay],
    html.${SIMPLE_CLASS}[data-runtime-right-open="true"] [data-runtime-overlay],
    html.${SIMPLE_CLASS}[data-runtime-detail-open="true"] [data-runtime-overlay] {
      display: block;
      opacity: 1;
      pointer-events: auto;
    }

    [data-runtime-left-drawer] {
      display: flex;
      position: fixed;
      inset: 0 auto 0 0;
      z-index: 110;
      width: min(86vw, 330px);
      box-sizing: border-box;
      flex-direction: column;
      padding: max(14px, env(safe-area-inset-top)) 12px max(14px, env(safe-area-inset-bottom));
      border-right: 1px solid #252932;
      background: #0d0f13;
      box-shadow: 30px 0 70px rgba(0,0,0,.38);
      transform: translateX(-105%);
      transition: transform 170ms ease;
    }

    html.${SIMPLE_CLASS}[data-runtime-left-open="true"] [data-runtime-left-drawer] { transform: translateX(0); }

    [data-runtime-left-drawer] h2 {
      margin: 7px 10px 12px;
      font-size: 16px;
      font-weight: 650;
    }

    [data-runtime-nav-button],
    [data-runtime-history-item],
    [data-runtime-project-item],
    [data-runtime-right-action] {
      width: 100%;
      min-height: 44px;
      border: 0;
      border-radius: 11px;
      background: transparent;
      color: #d6dae1;
      text-align: left;
      cursor: pointer;
    }

    [data-runtime-nav-button],
    [data-runtime-right-action] { padding: 0 12px; font-size: 13px; }

    [data-runtime-nav-button]:hover,
    [data-runtime-history-item]:hover,
    [data-runtime-project-item]:hover,
    [data-runtime-right-action]:hover,
    [data-runtime-nav-button]:focus-visible,
    [data-runtime-history-item]:focus-visible,
    [data-runtime-project-item]:focus-visible,
    [data-runtime-right-action]:focus-visible {
      outline: none;
      background: #191c22;
    }

    [data-runtime-section-label] {
      margin: 18px 11px 6px;
      color: #626a76;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .12em;
      text-transform: uppercase;
    }

    [data-runtime-history], [data-runtime-project-list] {
      display: grid;
      gap: 2px;
      min-height: 0;
      overflow: auto;
    }

    [data-runtime-history-item], [data-runtime-project-item] {
      display: grid;
      grid-template-columns: minmax(0,1fr) auto;
      align-items: center;
      gap: 7px;
      padding: 0 10px;
      font-size: 12px;
    }

    [data-runtime-history-item] span:first-child,
    [data-runtime-project-item] span:first-child {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    [data-runtime-history-item][data-active="true"] { background: #1b1f26; color: #fff; }
    [data-runtime-item-mark] { color: #848c99; font-size: 11px; }

    [data-runtime-project-creator] {
      display: none;
      grid-template-columns: minmax(0,1fr) auto;
      gap: 6px;
      margin: 6px 4px 2px;
    }

    [data-runtime-project-creator][data-open="true"] { display: grid; }

    [data-runtime-project-name] {
      min-width: 0;
      min-height: 42px;
      box-sizing: border-box;
      border: 1px solid #303640;
      border-radius: 10px;
      padding: 0 10px;
      outline: 0;
      background: #14171d;
      color: #f1f3f5;
    }

    [data-runtime-project-create] {
      min-width: 64px;
      min-height: 42px;
      border: 0;
      border-radius: 10px;
      background: #eceff3;
      color: #0d0f12;
      cursor: pointer;
    }

    [data-runtime-left-footer] {
      display: grid;
      gap: 4px;
      margin-top: auto;
      padding-top: 10px;
      border-top: 1px solid #1d2027;
    }

    [data-runtime-left-menu] {
      display: grid;
      grid-template-columns: repeat(2, 13px);
      place-content: center;
      gap: 3px;
      margin-top: 3px;
      background: #171a20;
    }

    [data-runtime-left-menu] span {
      display: block;
      height: 2px;
      border-radius: 999px;
      background: currentColor;
    }

    [data-runtime-right-menu] {
      display: none;
      position: fixed;
      top: calc(max(8px, env(safe-area-inset-top)) + 52px);
      right: 12px;
      z-index: 120;
      width: min(86vw, 300px);
      box-sizing: border-box;
      padding: 8px;
      border: 1px solid #292e37;
      border-radius: 16px;
      background: #111318;
      box-shadow: 0 22px 70px rgba(0,0,0,.46);
    }

    html.${SIMPLE_CLASS}[data-runtime-right-open="true"] [data-runtime-right-menu] { display: grid; }

    [data-runtime-right-action] {
      display: grid;
      grid-template-columns: 25px minmax(0,1fr) auto;
      align-items: center;
      gap: 8px;
    }

    [data-runtime-right-action] [data-icon] { color: #9ba3af; font-size: 15px; }
    [data-runtime-right-action] [data-meta] { color: #737b88; font-size: 10px; }

    [data-runtime-project-picker] {
      display: none;
      gap: 3px;
      padding: 5px 6px 8px 33px;
    }

    [data-runtime-project-picker][data-open="true"] { display: grid; }

    [data-runtime-project-pick] {
      min-height: 38px;
      border: 0;
      border-radius: 9px;
      padding: 0 9px;
      background: #181b21;
      color: #ccd1d9;
      text-align: left;
      cursor: pointer;
    }

    [data-runtime-detail-panel] {
      display: none;
      position: fixed;
      inset: auto 0 0 0;
      z-index: 130;
      max-height: min(72vh, 620px);
      box-sizing: border-box;
      overflow: auto;
      padding: 16px 16px max(20px, env(safe-area-inset-bottom));
      border-top: 1px solid #2a2f38;
      border-radius: 24px 24px 0 0;
      background: #101217;
      box-shadow: 0 -30px 80px rgba(0,0,0,.45);
    }

    html.${SIMPLE_CLASS}[data-runtime-detail-open="true"] [data-runtime-detail-panel] { display: block; }

    [data-runtime-detail-header] {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 14px;
    }

    [data-runtime-detail-header] h2 { margin: 0; font-size: 17px; }
    [data-runtime-detail-close] {
      min-width: 44px;
      min-height: 44px;
      border: 0;
      border-radius: 12px;
      background: #1a1d24;
      color: #e4e7eb;
      cursor: pointer;
    }

    [data-runtime-detail-list] { display: grid; gap: 8px; }
    [data-runtime-detail-item] {
      padding: 12px;
      border: 1px solid #292e37;
      border-radius: 12px;
      background: #15181e;
      color: #cfd4dc;
      font-size: 12px;
    }
    [data-runtime-detail-empty] { color: #747c89; font-size: 13px; padding: 18px 2px; }

    @media (min-width: 900px) {
      html.${SIMPLE_CLASS} [data-runtime-chat-main] { padding-top: 34px; }
      [data-runtime-detail-panel] {
        left: 50%;
        right: auto;
        width: min(700px, 90vw);
        transform: translateX(-50%);
        border: 1px solid #2a2f38;
        border-bottom: 0;
      }
    }
  `;
  document.head.append(style);
}

function closeAllMenus(): void {
  leftDrawerOpen = false;
  rightMenuOpen = false;
  detailPanel = null;
  projectPickerOpen = false;
  syncVisibility();
}

function syncVisibility(): void {
  const html = document.documentElement;
  html.dataset.runtimeLeftOpen = String(leftDrawerOpen && !advancedVisible);
  html.dataset.runtimeRightOpen = String(rightMenuOpen && !advancedVisible);
  html.dataset.runtimeDetailOpen = String(detailPanel !== null && !advancedVisible);
}

function visibleHistory(): ChatThread[] {
  return state.chats
    .filter((chat) => chat.messages.length > 0 && chat.archived === (drawerMode === "archive"))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function renderHistory(shell: HTMLElement): void {
  const history = shell.querySelector<HTMLElement>("[data-runtime-history]");
  if (history === null) return;
  history.replaceChildren();
  for (const chat of visibleHistory()) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.runtimeHistoryItem = chat.id;
    button.dataset.active = String(chat.id === state.activeChatId);
    const label = document.createElement("span");
    label.textContent = chat.title;
    const mark = document.createElement("span");
    mark.dataset.runtimeItemMark = "true";
    mark.textContent = chat.favorite ? "★" : "";
    button.append(label, mark);
    history.append(button);
  }
}

function renderProjects(shell: HTMLElement): void {
  const list = shell.querySelector<HTMLElement>("[data-runtime-project-list]");
  if (list === null) return;
  list.replaceChildren();
  for (const project of state.projects) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.runtimeProjectItem = project.id;
    const label = document.createElement("span");
    label.textContent = project.name;
    const count = document.createElement("span");
    count.dataset.runtimeItemMark = "true";
    count.textContent = String(state.chats.filter((chat) => chat.projectId === project.id && !chat.archived).length);
    button.append(label, count);
    list.append(button);
  }

  const picker = shell.querySelector<HTMLElement>("[data-runtime-project-picker]");
  if (picker !== null) {
    picker.replaceChildren();
    picker.dataset.open = String(projectPickerOpen);
    if (state.projects.length === 0) {
      const empty = document.createElement("span");
      empty.dataset.runtimeDetailEmpty = "true";
      empty.textContent = "Create a project from the left menu first.";
      picker.append(empty);
    } else {
      for (const project of state.projects) {
        const pick = document.createElement("button");
        pick.type = "button";
        pick.dataset.runtimeProjectPick = project.id;
        pick.textContent = project.name;
        picker.append(pick);
      }
    }
  }
}

function renderPending(shell: HTMLElement): void {
  const pending = shell.querySelector<HTMLElement>("[data-runtime-pending-media]");
  if (pending === null) return;
  pending.replaceChildren();
  pending.dataset.hasMedia = String(pendingFiles.length > 0);
  pendingFiles.forEach((file, index) => {
    const item = document.createElement("div");
    item.dataset.runtimePendingItem = "true";
    const name = document.createElement("span");
    name.textContent = file.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.runtimePendingRemove = String(index);
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.textContent = "×";
    item.append(name, remove);
    pending.append(item);
  });
}

function appendMessageMedia(container: HTMLElement, media: MediaAttachment[]): void {
  if (media.length === 0) return;
  const row = document.createElement("div");
  row.dataset.runtimeMessageMedia = "true";
  for (const item of media) {
    const chip = document.createElement("span");
    chip.dataset.runtimeMediaChip = "true";
    chip.textContent = item.name;
    row.append(chip);
  }
  container.append(row);
}

function renderMessages(shell: HTMLElement): void {
  const main = shell.querySelector<HTMLElement>("[data-runtime-chat-main]");
  const title = shell.querySelector<HTMLElement>("[data-runtime-chat-title]");
  if (main === null || title === null) return;
  const chat = activeChat();
  title.textContent = chat.messages.length === 0 ? "New chat" : chat.title;
  main.replaceChildren();
  if (chat.messages.length === 0) {
    const empty = document.createElement("div");
    empty.dataset.runtimeEmptyChat = "true";
    const heading = document.createElement("strong");
    heading.textContent = "What do you want to create?";
    const note = document.createElement("span");
    note.textContent = "Describe it, or add an image, video, or audio file.";
    empty.append(heading, note);
    main.append(empty);
    return;
  }

  const list = document.createElement("section");
  list.dataset.runtimeMessageList = "true";
  for (const message of chat.messages) {
    const bubble = document.createElement("article");
    bubble.dataset.runtimeMessage = message.role;
    if (message.text.trim().length > 0) {
      const text = document.createElement("div");
      text.textContent = message.text;
      bubble.append(text);
    }
    appendMessageMedia(bubble, message.media);
    list.append(bubble);
  }
  main.append(list);
  requestAnimationFrame(() => { main.scrollTop = main.scrollHeight; });
}

function allChatMedia(chat: ChatThread): MediaAttachment[] {
  return chat.messages.flatMap((message) => message.media);
}

function renderDetailPanel(shell: HTMLElement): void {
  const panel = shell.querySelector<HTMLElement>("[data-runtime-detail-panel]");
  const heading = shell.querySelector<HTMLElement>("[data-runtime-detail-title]");
  const list = shell.querySelector<HTMLElement>("[data-runtime-detail-list]");
  if (panel === null || heading === null || list === null || detailPanel === null) return;
  const chat = activeChat();
  list.replaceChildren();
  heading.textContent = detailPanel === "media" ? "Media in this chat" : "Results";

  if (detailPanel === "media") {
    const media = allChatMedia(chat);
    if (media.length === 0) {
      const empty = document.createElement("div");
      empty.dataset.runtimeDetailEmpty = "true";
      empty.textContent = "No media has been added to this chat yet.";
      list.append(empty);
      return;
    }
    for (const item of media) {
      const row = document.createElement("div");
      row.dataset.runtimeDetailItem = "true";
      row.textContent = `${item.name} · ${item.type || "media"}`;
      list.append(row);
    }
    return;
  }

  const results = chat.messages.filter((message) => message.role === "assistant");
  if (results.length === 0) {
    const empty = document.createElement("div");
    empty.dataset.runtimeDetailEmpty = "true";
    empty.textContent = "Generated results will appear here.";
    list.append(empty);
    return;
  }
  for (const message of results) {
    const row = document.createElement("div");
    row.dataset.runtimeDetailItem = "true";
    row.textContent = message.text || message.media.map((item) => item.name).join(", ");
    list.append(row);
  }
}

function renderRightMenu(shell: HTMLElement): void {
  const favorite = shell.querySelector<HTMLElement>("[data-runtime-right-action=\"favorite\"] [data-label]");
  const projectMeta = shell.querySelector<HTMLElement>("[data-runtime-right-action=\"project\"] [data-meta]");
  const chat = activeChat();
  if (favorite !== null) favorite.textContent = chat.favorite ? "Remove from favorites" : "Add to favorites";
  if (projectMeta !== null) {
    const project = state.projects.find((candidate) => candidate.id === chat.projectId);
    projectMeta.textContent = project?.name ?? "";
  }
}

function render(shell: HTMLElement): void {
  renderMessages(shell);
  renderPending(shell);
  renderHistory(shell);
  renderProjects(shell);
  renderRightMenu(shell);
  if (detailPanel !== null) renderDetailPanel(shell);
  const archiveButton = shell.querySelector<HTMLElement>("[data-runtime-nav-action=\"archive\"]");
  if (archiveButton !== null) archiveButton.textContent = drawerMode === "archive" ? "← Back to recent chats" : "Archive";
  const creator = shell.querySelector<HTMLElement>("[data-runtime-project-creator]");
  if (creator !== null) creator.dataset.open = String(projectCreatorOpen);
  const prompt = shell.querySelector<HTMLTextAreaElement>("[data-runtime-prompt]");
  const send = shell.querySelector<HTMLButtonElement>("[data-runtime-send]");
  if (send !== null) send.disabled = (prompt?.value.trim().length ?? 0) === 0 && pendingFiles.length === 0;
  saveState();
  syncVisibility();
}

function beginNewChat(shell: HTMLElement): void {
  const current = activeChat();
  if (current.messages.length > 0 || current.archived) {
    const chat = createEmptyChat();
    state.chats.push(chat);
    state.activeChatId = chat.id;
  }
  pendingFiles = [];
  drawerMode = "recent";
  leftDrawerOpen = false;
  rightMenuOpen = false;
  detailPanel = null;
  projectPickerOpen = false;
  const prompt = shell.querySelector<HTMLTextAreaElement>("[data-runtime-prompt]");
  if (prompt !== null) prompt.value = "";
  render(shell);
  prompt?.focus();
}

function submitChat(shell: HTMLElement): void {
  const promptNode = shell.querySelector<HTMLTextAreaElement>("[data-runtime-prompt]");
  if (promptNode === null) return;
  const prompt = promptNode.value.trim();
  if (prompt.length === 0 && pendingFiles.length === 0) return;
  const files = [...pendingFiles];
  const media = mediaFromFiles(files);
  const chat = activeChat();
  if (chat.messages.length === 0) chat.title = chatTitle(prompt, files);
  chat.messages.push({
    id: createId("message"),
    role: "user",
    text: prompt,
    createdAt: Date.now(),
    media,
  });
  chat.updatedAt = Date.now();
  chat.archived = false;

  window.dispatchEvent(new CustomEvent("aistudio:chat-submit", {
    detail: {
      chatId: chat.id,
      prompt,
      files,
      media,
    },
  }));

  promptNode.value = "";
  pendingFiles = [];
  render(shell);
  promptNode.focus();
}

function createProject(shell: HTMLElement): void {
  const input = shell.querySelector<HTMLInputElement>("[data-runtime-project-name]");
  const name = input?.value.trim() ?? "";
  if (name.length === 0) return;
  const project: ChatProject = { id: createId("project"), name, createdAt: Date.now() };
  state.projects.push(project);
  activeChat().projectId = project.id;
  projectCreatorOpen = false;
  if (input !== null) input.value = "";
  render(shell);
}

function handleNavAction(shell: HTMLElement, action: string): void {
  if (action === "new-chat") {
    beginNewChat(shell);
    return;
  }
  if (action === "new-project") {
    projectCreatorOpen = !projectCreatorOpen;
    render(shell);
    if (projectCreatorOpen) shell.querySelector<HTMLInputElement>("[data-runtime-project-name]")?.focus();
    return;
  }
  if (action === "archive") {
    drawerMode = drawerMode === "archive" ? "recent" : "archive";
    render(shell);
  }
}

function handleRightAction(shell: HTMLElement, action: string): void {
  const chat = activeChat();
  if (action === "media" || action === "results") {
    detailPanel = action;
    rightMenuOpen = false;
    projectPickerOpen = false;
    render(shell);
    return;
  }
  if (action === "favorite") {
    chat.favorite = !chat.favorite;
    chat.updatedAt = Date.now();
    render(shell);
    return;
  }
  if (action === "project") {
    projectPickerOpen = !projectPickerOpen;
    render(shell);
    return;
  }
  if (action === "archive") {
    chat.archived = true;
    chat.updatedAt = Date.now();
    beginNewChat(shell);
  }
}

function actionButton(action: string, icon: string, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.runtimeRightAction = action;
  const iconNode = document.createElement("span");
  iconNode.dataset.icon = "true";
  iconNode.setAttribute("aria-hidden", "true");
  iconNode.textContent = icon;
  const labelNode = document.createElement("span");
  labelNode.dataset.label = "true";
  labelNode.textContent = label;
  const meta = document.createElement("span");
  meta.dataset.meta = "true";
  button.append(iconNode, labelNode, meta);
  return button;
}

function ensureShell(): HTMLElement {
  let shell = document.querySelector<HTMLElement>("[data-runtime-chat-shell]");
  if (shell !== null) return shell;

  shell = document.createElement("section");
  shell.dataset.runtimeChatShell = "true";
  shell.setAttribute("aria-label", "AI Animation Studio chat");

  const header = document.createElement("header");
  header.dataset.runtimeChatHeader = "true";
  const title = document.createElement("div");
  title.dataset.runtimeChatTitle = "true";
  title.textContent = "New chat";
  const chatMenu = document.createElement("button");
  chatMenu.type = "button";
  chatMenu.dataset.runtimeChatMenu = "true";
  chatMenu.setAttribute("aria-label", "Chat menu");
  chatMenu.textContent = "☰";
  header.append(title, chatMenu);

  const main = document.createElement("main");
  main.dataset.runtimeChatMain = "true";

  const composerWrap = document.createElement("div");
  composerWrap.dataset.runtimeComposerWrap = "true";
  const pending = document.createElement("div");
  pending.dataset.runtimePendingMedia = "true";
  const composer = document.createElement("div");
  composer.dataset.runtimeComposer = "true";
  const attach = document.createElement("button");
  attach.type = "button";
  attach.dataset.runtimeAttach = "true";
  attach.setAttribute("aria-label", "Add media");
  attach.textContent = "+";
  const prompt = document.createElement("textarea");
  prompt.dataset.runtimePrompt = "true";
  prompt.rows = 1;
  prompt.placeholder = "Describe what you want to create…";
  prompt.setAttribute("aria-label", "Message");
  const send = document.createElement("button");
  send.type = "button";
  send.dataset.runtimeSend = "true";
  send.setAttribute("aria-label", "Send message");
  send.textContent = "↑";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.accept = "image/*,video/*,audio/*";
  fileInput.dataset.runtimeFileInput = "true";
  composer.append(attach, prompt, send, fileInput);
  composerWrap.append(pending, composer);

  const overlay = document.createElement("button");
  overlay.type = "button";
  overlay.dataset.runtimeOverlay = "true";
  overlay.setAttribute("aria-label", "Close menu");

  const leftDrawer = document.createElement("aside");
  leftDrawer.dataset.runtimeLeftDrawer = "true";
  leftDrawer.setAttribute("aria-label", "Chats and projects");
  const leftHeading = document.createElement("h2");
  leftHeading.textContent = "AI Animation Studio";
  const newChat = document.createElement("button");
  newChat.type = "button";
  newChat.dataset.runtimeNavButton = "true";
  newChat.dataset.runtimeNavAction = "new-chat";
  newChat.textContent = "+  New chat";
  const recentLabel = document.createElement("p");
  recentLabel.dataset.runtimeSectionLabel = "true";
  recentLabel.textContent = "Recent chats";
  const history = document.createElement("div");
  history.dataset.runtimeHistory = "true";
  const projectLabel = document.createElement("p");
  projectLabel.dataset.runtimeSectionLabel = "true";
  projectLabel.textContent = "Projects";
  const projectList = document.createElement("div");
  projectList.dataset.runtimeProjectList = "true";
  const newProject = document.createElement("button");
  newProject.type = "button";
  newProject.dataset.runtimeNavButton = "true";
  newProject.dataset.runtimeNavAction = "new-project";
  newProject.textContent = "+  Create new project";
  const creator = document.createElement("div");
  creator.dataset.runtimeProjectCreator = "true";
  const projectName = document.createElement("input");
  projectName.dataset.runtimeProjectName = "true";
  projectName.placeholder = "Project name";
  projectName.setAttribute("aria-label", "Project name");
  const create = document.createElement("button");
  create.type = "button";
  create.dataset.runtimeProjectCreate = "true";
  create.textContent = "Create";
  creator.append(projectName, create);
  const leftFooter = document.createElement("footer");
  leftFooter.dataset.runtimeLeftFooter = "true";
  const archive = document.createElement("button");
  archive.type = "button";
  archive.dataset.runtimeNavButton = "true";
  archive.dataset.runtimeNavAction = "archive";
  archive.textContent = "Archive";
  const leftMenu = document.createElement("button");
  leftMenu.type = "button";
  leftMenu.dataset.runtimeLeftMenu = "true";
  leftMenu.setAttribute("aria-label", "Open chats menu");
  leftMenu.append(document.createElement("span"), document.createElement("span"));
  leftFooter.append(archive, leftMenu);
  leftDrawer.append(leftHeading, newChat, recentLabel, history, projectLabel, projectList, newProject, creator, leftFooter);

  const rightMenu = document.createElement("aside");
  rightMenu.dataset.runtimeRightMenu = "true";
  rightMenu.setAttribute("aria-label", "Chat actions");
  rightMenu.append(
    actionButton("media", "▣", "Media in this chat"),
    actionButton("results", "✦", "Results"),
    actionButton("favorite", "☆", "Add to favorites"),
    actionButton("project", "+", "Add to project"),
  );
  const picker = document.createElement("div");
  picker.dataset.runtimeProjectPicker = "true";
  rightMenu.append(picker, actionButton("archive", "⌁", "Archive chat"));

  const detail = document.createElement("section");
  detail.dataset.runtimeDetailPanel = "true";
  const detailHeader = document.createElement("header");
  detailHeader.dataset.runtimeDetailHeader = "true";
  const detailTitle = document.createElement("h2");
  detailTitle.dataset.runtimeDetailTitle = "true";
  const detailClose = document.createElement("button");
  detailClose.type = "button";
  detailClose.dataset.runtimeDetailClose = "true";
  detailClose.setAttribute("aria-label", "Close panel");
  detailClose.textContent = "×";
  detailHeader.append(detailTitle, detailClose);
  const detailList = document.createElement("div");
  detailList.dataset.runtimeDetailList = "true";
  detail.append(detailHeader, detailList);

  shell.append(header, main, composerWrap, overlay, leftDrawer, rightMenu, detail);
  document.body.append(shell);

  attach.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const selected = Array.from(fileInput.files ?? []);
    pendingFiles.push(...selected);
    fileInput.value = "";
    render(shell as HTMLElement);
  });
  prompt.addEventListener("input", () => render(shell as HTMLElement));
  prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitChat(shell as HTMLElement);
    }
  });
  send.addEventListener("click", () => submitChat(shell as HTMLElement));
  pending.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-runtime-pending-remove]") : null;
    if (target === null) return;
    const index = Number.parseInt(target.dataset.runtimePendingRemove ?? "-1", 10);
    if (Number.isInteger(index) && index >= 0) pendingFiles.splice(index, 1);
    render(shell as HTMLElement);
  });

  chatMenu.addEventListener("click", () => {
    rightMenuOpen = !rightMenuOpen;
    leftDrawerOpen = false;
    detailPanel = null;
    syncVisibility();
  });
  leftMenu.addEventListener("click", () => {
    leftDrawerOpen = !leftDrawerOpen;
    rightMenuOpen = false;
    detailPanel = null;
    syncVisibility();
  });
  overlay.addEventListener("click", closeAllMenus);
  detailClose.addEventListener("click", closeAllMenus);

  leftDrawer.addEventListener("click", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const nav = element?.closest<HTMLButtonElement>("[data-runtime-nav-action]");
    if (nav !== null && nav !== undefined) {
      handleNavAction(shell as HTMLElement, nav.dataset.runtimeNavAction ?? "");
      return;
    }
    const historyButton = element?.closest<HTMLButtonElement>("[data-runtime-history-item]");
    if (historyButton !== null && historyButton !== undefined) {
      state.activeChatId = historyButton.dataset.runtimeHistoryItem ?? state.activeChatId;
      pendingFiles = [];
      leftDrawerOpen = false;
      render(shell as HTMLElement);
      return;
    }
    const projectButton = element?.closest<HTMLButtonElement>("[data-runtime-project-item]");
    if (projectButton !== null && projectButton !== undefined) {
      const projectId = projectButton.dataset.runtimeProjectItem ?? "";
      const chat = state.chats
        .filter((candidate) => candidate.projectId === projectId && !candidate.archived)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (chat !== undefined) state.activeChatId = chat.id;
      leftDrawerOpen = false;
      render(shell as HTMLElement);
    }
  });
  create.addEventListener("click", () => createProject(shell as HTMLElement));
  projectName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") createProject(shell as HTMLElement);
  });

  rightMenu.addEventListener("click", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const pick = element?.closest<HTMLButtonElement>("[data-runtime-project-pick]");
    if (pick !== null && pick !== undefined) {
      activeChat().projectId = pick.dataset.runtimeProjectPick ?? null;
      activeChat().updatedAt = Date.now();
      projectPickerOpen = false;
      rightMenuOpen = false;
      render(shell as HTMLElement);
      return;
    }
    const action = element?.closest<HTMLButtonElement>("[data-runtime-right-action]");
    if (action !== null && action !== undefined) handleRightAction(shell as HTMLElement, action.dataset.runtimeRightAction ?? "");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllMenus();
  });

  render(shell);
  return shell;
}

function appendRuntimeResult(event: Event): void {
  const custom = event as CustomEvent<RuntimeChatResultDetail>;
  const detail = custom.detail;
  if (detail === null || typeof detail !== "object") return;
  const chat = state.chats.find((candidate) => candidate.id === (detail.chatId ?? state.activeChatId));
  if (chat === undefined) return;
  const media: MediaAttachment[] = Array.isArray(detail.media)
    ? detail.media.map((item) => ({
        id: typeof item.id === "string" ? item.id : createId("result"),
        name: typeof item.name === "string" ? item.name : "Generated media",
        type: typeof item.type === "string" ? item.type : "application/octet-stream",
        size: typeof item.size === "number" ? item.size : 0,
      }))
    : [];
  const text = typeof detail.text === "string" ? detail.text : "";
  if (text.trim().length === 0 && media.length === 0) return;
  chat.messages.push({ id: createId("message"), role: "assistant", text, createdAt: Date.now(), media });
  chat.updatedAt = Date.now();
  saveState();
  const shell = document.querySelector<HTMLElement>("[data-runtime-chat-shell]");
  if (shell !== null) render(shell);
}

function syncSimpleUi(): void {
  if (window.AIStudioRuntime === undefined) return;
  ensureStyles();
  const html = document.documentElement;
  html.classList.toggle(SIMPLE_CLASS, !advancedVisible);
  html.classList.toggle(ADVANCED_CLASS, advancedVisible);
  if (!advancedVisible) {
    const shell = ensureShell();
    render(shell);
  }
  syncVisibility();
}

export function installRuntimeSimpleUi(): void {
  window.addEventListener("aistudio:runtime-ready", syncSimpleUi);
  window.addEventListener("aistudio:chat-result", appendRuntimeResult);
  window.addEventListener("aistudio:runtime-show-advanced", () => {
    advancedVisible = true;
    closeAllMenus();
    syncSimpleUi();
  });
  window.addEventListener("aistudio:runtime-show-chat", () => {
    advancedVisible = false;
    syncSimpleUi();
  });
  syncSimpleUi();
}

installRuntimeSimpleUi();
