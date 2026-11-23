# opencode-desktop-agent-tree

**Левая панель → «+» → «Агенты».** Вкладка показывает дерево текущей беседы: агент, поручение и текущий статус. Завершившиеся агенты остаются в дереве.

Для локальной установки запустите `node build.cjs`, скопируйте `gui-experimental.cjs` в `~/.config/opencode/local-themes/agent-tree/` и добавьте `"./local-themes/agent-tree"` в `plugins` глобального `~/.config/opencode/opencode.jsonc`. Работает во всех проектах в OpenCode Desktop 2.3.2. Для удаления достаточно убрать эту запись.

Проверка: `node --test`.
