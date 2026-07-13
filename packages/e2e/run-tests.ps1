# Запуск E2E тестов Playwright
# Использование: .\run-tests.ps1
# С UI: .\run-tests.ps1 -UI
# Только конкретный файл: .\run-tests.ps1 -Test 02-dashboard

param(
  [switch]$UI,
  [string]$Test = ""
)

if ($UI) {
  npx playwright test --ui
} elseif ($Test) {
  npx playwright test "tests/$Test"
} else {
  npx playwright test
}
