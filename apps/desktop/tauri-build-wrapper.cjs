// Wrapper to bypass the @tauri-apps/cli tauri.js arg-parsing bug.
// The harness (DSH Desktop) runs node with process.argv[0] = DSH Desktop.exe,
// so tauri.js's `else` branch does args.unshift(bin) and injects the harness
// exe path as a bogus subcommand. This wrapper calls the native binding
// directly with hardcoded CLI args, skipping that logic entirely.
const { run } = require('./node_modules/@tauri-apps/cli/main.js')

const args = process.argv.slice(2) // e.g. ['build'] or ['--version']
const binName = 'tauri ' + (args[0] || '')

run(args, binName, (error, res) => {
  if (error) {
    console.error('TAURI_ERROR:', String(error))
    process.exit(1)
  }
  if (res) console.log(res)
  process.exit(0)
})
