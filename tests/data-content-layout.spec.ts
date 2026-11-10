import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const styles = readFileSync(fileURLToPath(new URL(
  '../../solid-panes/src/dataContentPane.css', import.meta.url
)), 'utf8')

for (const width of [1200, 1000, 850, 390]) {
  test(`nested formulas fit their available width at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.setContent(`
      <div class="data-content-pane">
        <table class="data-content-pane__table data-content-pane__table--root">
          <tr class="data-content-pane__row--root data-content-pane__row--even">
            <th class="data-content-pane__subject-cell">me</th>
            <td class="data-content-pane__details-cell">
              <table class="data-content-pane__table data-content-pane__table--property">
                <tr class="data-content-pane__row--property data-content-pane__row--top-aligned">
                  <th class="data-content-pane__predicate-cell">example</th>
                  <td class="data-content-pane__value-cell">
                    <table class="data-content-pane__table data-content-pane__table--root data-content-pane__nested-formula">
                      <tr class="data-content-pane__row--root data-content-pane__row--even">
                        <th class="data-content-pane__subject-cell">item</th>
                        <td class="data-content-pane__details-cell">
                          <table class="data-content-pane__table data-content-pane__table--property">
                            <tr class="data-content-pane__row--property data-content-pane__row--top-aligned">
                              <th class="data-content-pane__predicate-cell">label</th>
                              <td class="data-content-pane__value-cell">Nested formula example</td>
                            </tr>
                            <tr class="data-content-pane__row--property data-content-pane__row--top-aligned">
                              <th class="data-content-pane__predicate-cell">note</th>
                              <td class="data-content-pane__value-cell">These statements are inside the formula.</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    `)
    await page.addStyleTag({ content: styles })
    await page.addStyleTag({ content: 'th { background-color: white; padding: 8px; }' })

    const formula = page.locator('.data-content-pane__nested-formula')
    const measurements = await formula.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return {
        width: bounds.width,
        overflow: element.scrollWidth - element.clientWidth,
        cellsFit: Array.from(element.querySelectorAll('th, td')).every(cell =>
          cell.getBoundingClientRect().right <= bounds.right + 1
        ),
        valueWidths: Array.from(element.querySelectorAll('.data-content-pane__value-cell'))
          .map(cell => cell.getBoundingClientRect().width),
        headersMatchRows: Array.from(element.querySelectorAll('th')).every(cell =>
          getComputedStyle(cell).backgroundColor === getComputedStyle(cell.parentElement!).backgroundColor
        )
      }
    })
    expect(measurements.width).toBeGreaterThan(200)
    expect(measurements.overflow).toBeLessThanOrEqual(1)
    expect(measurements.cellsFit).toBe(true)
    expect(measurements.headersMatchRows).toBe(true)
    for (const valueWidth of measurements.valueWidths) {
      expect(valueWidth).toBeGreaterThan(120)
    }
    await expect(formula).toContainText('These statements are inside the formula.')
  })
}
