import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'test-results/**', 'playwright-report/**', '.cloudflare/**'] },
  ...tseslint.configs.recommended,
)
