import { useState, useEffect, useCallback } from "react";
import { getLang, setLang as setLangGlobal, subscribeLang, t as translate } from "../../js/i18n.js";

export function useI18n() {
  const [lang, setLangState] = useState(getLang);

  useEffect(() => subscribeLang(setLangState), []);

  const setLang = useCallback((l) => setLangGlobal(l), []);
  const t = useCallback((key, params) => translate(key, params), [lang]);

  return { lang, setLang, t };
}
