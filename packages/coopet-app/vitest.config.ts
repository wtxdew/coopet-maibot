import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** `cortico/*` 指向钉住的框架子模块（tests/paths.test.ts 会导入核心的代码）；与核心的 vitest.config.ts 一致。 */
const FRAMEWORK_SRC = fileURLToPath(new URL('../../vendor/cortico/src/', import.meta.url));

export default defineConfig({
  resolve: { alias: [{ find: /^cortico\//, replacement: FRAMEWORK_SRC }] },
  test: { include: ['tests/**/*.test.ts'] },
});
