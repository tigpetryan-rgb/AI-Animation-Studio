type RuntimeLocale = "en" | "hy" | "ru";

type RuntimeStrings = {
  emptyTitle: string;
  emptyNote: string;
  newChat: string;
  message: string;
  addMedia: string;
  sendMessage: string;
  chatMenu: string;
  openChats: string;
  recentChats: string;
  projects: string;
  createProject: string;
  projectName: string;
  create: string;
  archive: string;
  backRecent: string;
  closeMenu: string;
  chatsProjects: string;
  mediaInChat: string;
  results: string;
  addFavorite: string;
  removeFavorite: string;
  addProject: string;
  archiveChat: string;
  image: string;
  video: string;
  audio: string;
  file: string;
};

const STRINGS: Record<RuntimeLocale, RuntimeStrings> = {
  en: {
    emptyTitle: "What do you want to create?",
    emptyNote: "Describe it, or add an image, video, or audio file.",
    newChat: "New chat",
    message: "Message",
    addMedia: "Add media",
    sendMessage: "Send message",
    chatMenu: "Chat menu",
    openChats: "Open chats menu",
    recentChats: "Recent chats",
    projects: "Projects",
    createProject: "+  Create new project",
    projectName: "Project name",
    create: "Create",
    archive: "Archive",
    backRecent: "← Back to recent chats",
    closeMenu: "Close menu",
    chatsProjects: "Chats and projects",
    mediaInChat: "Media in this chat",
    results: "Results",
    addFavorite: "Add to favorites",
    removeFavorite: "Remove from favorites",
    addProject: "Add to project",
    archiveChat: "Archive chat",
    image: "Image",
    video: "Video",
    audio: "Audio",
    file: "File",
  },
  hy: {
    emptyTitle: "Ի՞նչ եք ուզում ստեղծել",
    emptyNote: "Նկարագրեք կամ ավելացրեք նկար, տեսանյութ կամ ձայնային ֆայլ։",
    newChat: "Նոր չատ",
    message: "Հաղորդագրություն",
    addMedia: "Ավելացնել մեդիա",
    sendMessage: "Ուղարկել հաղորդագրությունը",
    chatMenu: "Չատի մենյու",
    openChats: "Բացել չատերի մենյուն",
    recentChats: "Վերջին չատերը",
    projects: "Նախագծեր",
    createProject: "+  Նոր նախագիծ",
    projectName: "Նախագծի անուն",
    create: "Ստեղծել",
    archive: "Արխիվ",
    backRecent: "← Վերադառնալ վերջին չատերին",
    closeMenu: "Փակել մենյուն",
    chatsProjects: "Չատեր և նախագծեր",
    mediaInChat: "Այս չատի մեդիան",
    results: "Արդյունքներ",
    addFavorite: "Ավելացնել ընտրյալներին",
    removeFavorite: "Հեռացնել ընտրյալներից",
    addProject: "Ավելացնել նախագծին",
    archiveChat: "Արխիվացնել չատը",
    image: "Նկար",
    video: "Տեսանյութ",
    audio: "Ձայն",
    file: "Ֆայլ",
  },
  ru: {
    emptyTitle: "Что вы хотите создать?",
    emptyNote: "Опишите идею или добавьте изображение, видео или аудиофайл.",
    newChat: "Новый чат",
    message: "Сообщение",
    addMedia: "Добавить медиа",
    sendMessage: "Отправить сообщение",
    chatMenu: "Меню чата",
    openChats: "Открыть список чатов",
    recentChats: "Недавние чаты",
    projects: "Проекты",
    createProject: "+  Новый проект",
    projectName: "Название проекта",
    create: "Создать",
    archive: "Архив",
    backRecent: "← Назад к недавним чатам",
    closeMenu: "Закрыть меню",
    chatsProjects: "Чаты и проекты",
    mediaInChat: "Медиа в этом чате",
    results: "Результаты",
    addFavorite: "Добавить в избранное",
    removeFavorite: "Удалить из избранного",
    addProject: "Добавить в проект",
    archiveChat: "Архивировать чат",
    image: "Изображение",
    video: "Видео",
    audio: "Аудио",
    file: "Файл",
  },
};

type MediaPreview = {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  readonly url: string;
};

const previewsByName = new Map<string, MediaPreview>();
let syncQueued = false;

function runtimeLocale(): RuntimeLocale {
  const language = (navigator.languages?.[0] ?? navigator.language ?? "en").toLowerCase();
  if (language.startsWith("hy")) return "hy";
  if (language.startsWith("ru")) return "ru";
  return "en";
}

function setText(node: Element | null, value: string): void {
  if (node !== null && node.textContent !== value) node.textContent = value;
}

function setAria(node: Element | null, value: string): void {
  if (node !== null && node.getAttribute("aria-label") !== value) node.setAttribute("aria-label", value);
}

function ensureStyles(): void {
  if (document.querySelector("style[data-runtime-mobile-ux]") !== null) return;
  const style = document.createElement("style");
  style.dataset.runtimeMobileUx = "true";
  style.textContent = `
    html.runtime-simple-ui [data-runtime-chat-shell] {
      grid-template-rows: 72px minmax(0, 1fr) auto !important;
      touch-action: manipulation;
    }

    html.runtime-simple-ui [data-runtime-chat-header] {
      padding-top: calc(max(8px, env(safe-area-inset-top)) + 6px) !important;
    }

    html.runtime-simple-ui [data-runtime-left-menu] {
      top: calc(max(8px, env(safe-area-inset-top)) + 6px) !important;
    }

    [data-runtime-rich-preview] {
      position: relative;
      overflow: hidden;
      border: 1px solid #343a45;
      border-radius: 14px;
      background: #0e1116;
    }

    [data-runtime-pending-item] {
      display: grid !important;
      grid-template-columns: 64px minmax(0, 1fr) 30px;
      width: min(300px, 78vw);
      min-height: 72px !important;
      box-sizing: border-box;
      padding: 5px 6px !important;
      align-items: center;
    }

    [data-runtime-pending-item] > [data-runtime-rich-preview] {
      width: 62px;
      height: 62px;
      grid-row: 1 / span 2;
    }

    [data-runtime-pending-item] > [data-runtime-media-meta] {
      min-width: 0;
      padding-left: 4px;
      color: #89919e;
      font-size: 10px;
    }

    [data-runtime-pending-item] > span:not([data-runtime-media-meta]) {
      min-width: 0;
      padding-left: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #e1e4e9;
    }

    [data-runtime-pending-remove] {
      grid-column: 3;
      grid-row: 1 / span 2;
      align-self: center;
    }

    [data-runtime-rich-preview] img,
    [data-runtime-rich-preview] video {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
      background: #080a0d;
    }

    [data-runtime-rich-preview-kind] {
      display: grid;
      width: 100%;
      height: 100%;
      place-content: center;
      gap: 3px;
      color: #d8dde5;
      text-align: center;
      font-size: 10px;
    }

    [data-runtime-rich-preview-kind] strong {
      font-size: 22px;
      font-weight: 500;
    }

    [data-runtime-video-badge] {
      position: absolute;
      left: 50%;
      top: 50%;
      display: grid;
      width: 28px;
      height: 28px;
      place-content: center;
      border-radius: 999px;
      background: rgba(0, 0, 0, .62);
      color: #fff;
      transform: translate(-50%, -50%);
      font-size: 12px;
    }

    [data-runtime-media-chip][data-runtime-richified="true"] {
      display: grid !important;
      width: min(220px, 68vw);
      max-width: none !important;
      padding: 5px !important;
      gap: 6px;
      border-radius: 15px !important;
    }

    [data-runtime-media-chip][data-runtime-richified="true"] [data-runtime-rich-preview] {
      width: 100%;
      aspect-ratio: 16 / 10;
    }

    [data-runtime-media-chip][data-runtime-richified="true"] [data-runtime-media-label] {
      padding: 0 4px 3px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;
  document.head.append(style);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mediaLabel(type: string, strings: RuntimeStrings): string {
  if (type.startsWith("image/")) return strings.image;
  if (type.startsWith("video/")) return strings.video;
  if (type.startsWith("audio/")) return strings.audio;
  return strings.file;
}

function createPreview(preview: MediaPreview, strings: RuntimeStrings): HTMLElement {
  const container = document.createElement("div");
  container.dataset.runtimeRichPreview = "true";
  if (preview.type.startsWith("image/")) {
    const image = document.createElement("img");
    image.src = preview.url;
    image.alt = preview.name;
    container.append(image);
    return container;
  }
  if (preview.type.startsWith("video/")) {
    const video = document.createElement("video");
    video.src = preview.url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    const badge = document.createElement("span");
    badge.dataset.runtimeVideoBadge = "true";
    badge.textContent = "▶";
    container.append(video, badge);
    return container;
  }
  const kind = document.createElement("div");
  kind.dataset.runtimeRichPreviewKind = "true";
  const icon = document.createElement("strong");
  icon.textContent = preview.type.startsWith("audio/") ? "♫" : "▤";
  const label = document.createElement("span");
  label.textContent = mediaLabel(preview.type, strings);
  kind.append(icon, label);
  container.append(kind);
  return container;
}

function rememberFiles(input: HTMLInputElement): void {
  for (const file of Array.from(input.files ?? [])) {
    const previous = previewsByName.get(file.name);
    if (previous !== undefined) URL.revokeObjectURL(previous.url);
    previewsByName.set(file.name, {
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      url: URL.createObjectURL(file),
    });
  }
}

function enhancePending(strings: RuntimeStrings): void {
  document.querySelectorAll<HTMLElement>("[data-runtime-pending-item]").forEach((item) => {
    if (item.dataset.runtimeRichified === "true") return;
    const nameNode = item.querySelector<HTMLElement>("span");
    const name = nameNode?.textContent?.trim() ?? "";
    const preview = previewsByName.get(name);
    if (preview === undefined) return;
    item.dataset.runtimeRichified = "true";
    item.prepend(createPreview(preview, strings));
    const meta = document.createElement("span");
    meta.dataset.runtimeMediaMeta = "true";
    meta.textContent = `${mediaLabel(preview.type, strings)} · ${formatBytes(preview.size)}`;
    const remove = item.querySelector("[data-runtime-pending-remove]");
    item.insertBefore(meta, remove);
  });
}

function enhanceSentMedia(strings: RuntimeStrings): void {
  document.querySelectorAll<HTMLElement>("[data-runtime-media-chip]").forEach((chip) => {
    if (chip.dataset.runtimeRichified === "true") return;
    const name = chip.textContent?.trim() ?? "";
    const preview = previewsByName.get(name);
    if (preview === undefined) return;
    chip.dataset.runtimeRichified = "true";
    const label = document.createElement("span");
    label.dataset.runtimeMediaLabel = "true";
    label.textContent = `${preview.name} · ${mediaLabel(preview.type, strings)} · ${formatBytes(preview.size)}`;
    chip.replaceChildren(createPreview(preview, strings), label);
  });
}

function localize(strings: RuntimeStrings, locale: RuntimeLocale): void {
  document.documentElement.lang = locale;
  setText(document.querySelector("[data-runtime-empty-chat] strong"), strings.emptyTitle);
  setText(document.querySelector("[data-runtime-empty-chat] span"), strings.emptyNote);

  const title = document.querySelector("[data-runtime-chat-title]");
  if (title?.textContent === "New chat" || title?.textContent === "Новый чат" || title?.textContent === "Նոր չատ") setText(title, strings.newChat);

  const prompt = document.querySelector<HTMLTextAreaElement>("[data-runtime-prompt]");
  if (prompt !== null) {
    prompt.placeholder = strings.emptyTitle;
    setAria(prompt, strings.message);
  }
  setAria(document.querySelector("[data-runtime-attach]"), strings.addMedia);
  setAria(document.querySelector("[data-runtime-send]"), strings.sendMessage);
  setAria(document.querySelector("[data-runtime-chat-menu]"), strings.chatMenu);
  setAria(document.querySelector("[data-runtime-left-menu]"), strings.openChats);
  setAria(document.querySelector("[data-runtime-overlay]"), strings.closeMenu);
  setAria(document.querySelector("[data-runtime-left-drawer]"), strings.chatsProjects);

  document.querySelectorAll<HTMLElement>("[data-runtime-section-label]").forEach((label) => {
    const value = label.textContent?.trim();
    if (value === "Recent chats" || value === "Недавние чаты" || value === "Վերջին չատերը") setText(label, strings.recentChats);
    if (value === "Projects" || value === "Проекты" || value === "Նախագծեր") setText(label, strings.projects);
  });

  setText(document.querySelector("[data-runtime-nav-action=\"new-chat\"]"), `+  ${strings.newChat}`);
  setText(document.querySelector("[data-runtime-nav-action=\"new-project\"]"), strings.createProject);
  const archive = document.querySelector("[data-runtime-nav-action=\"archive\"]");
  if (archive !== null) {
    const back = archive.textContent?.includes("←") ?? false;
    setText(archive, back ? strings.backRecent : strings.archive);
  }

  const projectName = document.querySelector<HTMLInputElement>("[data-runtime-project-name]");
  if (projectName !== null) {
    projectName.placeholder = strings.projectName;
    setAria(projectName, strings.projectName);
  }
  setText(document.querySelector("[data-runtime-project-create]"), strings.create);

  const labels: Record<string, string> = {
    media: strings.mediaInChat,
    results: strings.results,
    project: strings.addProject,
    archive: strings.archiveChat,
  };
  Object.entries(labels).forEach(([action, label]) => setText(
    document.querySelector(`[data-runtime-right-action=\"${action}\"] [data-label]`),
    label,
  ));
  const favorite = document.querySelector("[data-runtime-right-action=\"favorite\"] [data-label]");
  if (favorite !== null) {
    const removing = /Remove|Удалить|Հեռացնել/.test(favorite.textContent ?? "");
    setText(favorite, removing ? strings.removeFavorite : strings.addFavorite);
  }
}

function syncMobileUx(): void {
  syncQueued = false;
  ensureStyles();
  const locale = runtimeLocale();
  const strings = STRINGS[locale];
  localize(strings, locale);
  enhancePending(strings);
  enhanceSentMedia(strings);
}

function scheduleSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(syncMobileUx);
}

document.addEventListener("change", (event) => {
  const input = event.target instanceof HTMLInputElement && event.target.matches("[data-runtime-file-input]")
    ? event.target
    : null;
  if (input !== null) rememberFiles(input);
  scheduleSync();
}, true);

window.addEventListener("aistudio:runtime-ready", scheduleSync);
window.addEventListener("languagechange", scheduleSync);
new MutationObserver(scheduleSync).observe(document.documentElement, { childList: true, subtree: true });
scheduleSync();
