/* global __BUILD_VERSION__ */

export const worldRuleLanguages = [
  { code: "en", englishName: "English", nativeName: "English" },
  { code: "es", englishName: "Spanish", nativeName: "Español" },
  { code: "fr", englishName: "French", nativeName: "Français" },
  { code: "de", englishName: "German", nativeName: "Deutsch" },
  { code: "ja", englishName: "Japanese", nativeName: "Japanese" },
  { code: "ru", englishName: "Russian", nativeName: "Русский" },
  { code: "ko", englishName: "Korean", nativeName: "한국어" },
  { code: "zh-Hant", englishName: "Traditional Chinese", nativeName: "Traditional Chinese" },
  { code: "zh-Hans", englishName: "Simplified Chinese", nativeName: "Simplified Chinese" },
];

const defaultLanguage = "en";
const languageStorageKey = "nicechunk.language";
const localeVersionPrefix = "nicechunk.worldRule.locale.version.";
const localeDataPrefix = "nicechunk.worldRule.locale.data.";
const buildVersion = typeof __BUILD_VERSION__ === "string" ? __BUILD_VERSION__ : String(Date.now());

let activeLanguage = normalizeLanguage(localStorage.getItem(languageStorageKey)) || defaultLanguage;
let activeDictionary = {};

export async function initWorldRuleI18n() {
  await loadLanguage(activeLanguage);
  applyWorldRuleTranslations();
  setupWorldRuleLanguageMenu();
  return activeDictionary;
}

export async function setWorldRuleLanguage(language) {
  activeLanguage = normalizeLanguage(language) || defaultLanguage;
  localStorage.setItem(languageStorageKey, activeLanguage);
  await loadLanguage(activeLanguage);
  applyWorldRuleTranslations();
  setupWorldRuleLanguageMenu();
  window.dispatchEvent(new CustomEvent("nicechunk:worldrulelanguagechange", { detail: { language: activeLanguage } }));
}

export function worldRuleT(key, params = {}) {
  const template = getByPath(activeDictionary, key) ?? key;
  return interpolate(String(template), params);
}

export function worldRuleList(key) {
  const value = getByPath(activeDictionary, key);
  return Array.isArray(value) ? value : [];
}

export function applyWorldRuleTranslations(root = document) {
  document.documentElement.lang = activeLanguage;

  root.querySelectorAll("[data-wr-i18n]").forEach((element) => {
    element.textContent = worldRuleT(element.dataset.wrI18n);
  });

  translateAttribute(root, "data-wr-i18n-aria-label", "aria-label");
  translateAttribute(root, "data-wr-i18n-title", "title");
  translateAttribute(root, "data-wr-i18n-placeholder", "placeholder");
}

function setupWorldRuleLanguageMenu() {
  const control = document.querySelector(".language-control");
  const trigger = document.querySelector("#languageTrigger");
  const current = document.querySelector("#languageCurrent");
  const menu = document.querySelector("#languageMenu");
  if (!control || !trigger || !current || !menu) return;

  current.textContent = languageLabel(activeLanguage);
  trigger.setAttribute("aria-expanded", control.classList.contains("open") ? "true" : "false");

  if (!menu.dataset.ready) {
    menu.replaceChildren(
      ...worldRuleLanguages.map((language) => {
        const option = document.createElement("button");
        option.className = "language-option";
        option.type = "button";
        option.role = "option";
        option.dataset.language = language.code;
        option.innerHTML = `
          <span>${language.englishName}</span>
          <span class="language-native">${language.nativeName}</span>
        `;
        option.addEventListener("click", () => {
          control.classList.remove("open");
          setWorldRuleLanguage(language.code);
        });
        return option;
      }),
    );
    trigger.addEventListener("click", () => {
      const open = !control.classList.contains("open");
      control.classList.toggle("open", open);
      trigger.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("pointerdown", (event) => {
      if (control.contains(event.target)) return;
      control.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
    });
    menu.dataset.ready = "true";
  }

  menu.querySelectorAll(".language-option").forEach((option) => {
    option.classList.toggle("active", option.dataset.language === activeLanguage);
    option.setAttribute("aria-selected", String(option.dataset.language === activeLanguage));
  });
}

async function loadLanguage(language) {
  const normalized = normalizeLanguage(language) || defaultLanguage;
  const cachedVersion = localStorage.getItem(`${localeVersionPrefix}${normalized}`);
  const cachedData = localStorage.getItem(`${localeDataPrefix}${normalized}`);

  if (cachedVersion === buildVersion && cachedData) {
    activeDictionary = JSON.parse(cachedData);
    return;
  }

  const response = await fetch(`/world_rule/locales/${normalized}.json?v=${buildVersion}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load world rule locale: ${normalized}`);
  activeDictionary = await response.json();
  localStorage.setItem(`${localeVersionPrefix}${normalized}`, buildVersion);
  localStorage.setItem(`${localeDataPrefix}${normalized}`, JSON.stringify(activeDictionary));
}

function translateAttribute(root, dataName, attributeName) {
  root.querySelectorAll(`[${dataName}]`).forEach((element) => {
    element.setAttribute(attributeName, worldRuleT(element.getAttribute(dataName)));
  });
}

function languageLabel(code) {
  const language = worldRuleLanguages.find((entry) => entry.code === code) ?? worldRuleLanguages[0];
  return `${language.englishName} (${language.nativeName})`;
}

function normalizeLanguage(language) {
  return worldRuleLanguages.some((entry) => entry.code === language) ? language : null;
}

function getByPath(source, path) {
  return path.split(".").reduce((value, segment) => value?.[segment], source);
}

function interpolate(template, params) {
  return template.replace(/\{(\w+)\}/g, (_match, key) => params[key] ?? "");
}
