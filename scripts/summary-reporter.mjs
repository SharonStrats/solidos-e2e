import { relative } from 'node:path'

const marker = '@@E2E_SUMMARY@@'

export default class SummaryReporter {
  results = []

  onTestEnd (test, result) {
    const status = result.status === 'skipped'
      ? 'skipped'
      : result.status === 'passed'
        ? 'passed'
        : 'failed'
    const location = `${relative(process.cwd(), test.location.file)}:${test.location.line}:${test.location.column}`
    this.results.push({
      status,
      title: test.titlePath().slice(1).join(' › ') || test.title,
      location
    })
  }

  onEnd () {
    const summary = {
      passed: this.results.filter(result => result.status === 'passed').length,
      failed: this.results.filter(result => result.status === 'failed').length,
      skipped: this.results.filter(result => result.status === 'skipped').length,
      failures: this.results
        .filter(result => result.status === 'failed')
        .map(({ title, location }) => ({ title, location }))
    }
    process.stdout.write(`${marker}${JSON.stringify(summary)}\n`)
  }
}
