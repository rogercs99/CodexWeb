import { test, expect } from '@playwright/test';

const password = 'secret123';

function makeUser(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.slice(0, 18);
}

async function registerViaApi(page, username, displayName) {
  const response = await page.context().request.post('http://localhost:3000/api/auth/register', {
    headers: { 'Content-Type': 'application/json' },
    data: { username, password, displayName },
  });
  const body = await response.json();
  expect(response.ok(), body.error || 'register failed').toBeTruthy();
}

async function runHumanTurn(page) {
  if (await page.locator('#clue-input').isVisible({ timeout: 4000 }).catch(() => false)) {
    await page.locator('#clue-hand div').first().click();
    await page.fill('#clue-input', 'pista de prueba');
    await page.getByRole('button', { name: 'Enviar' }).click();
    return;
  }

  await expect(page.getByText('Elige la carta que más encaje')).toBeVisible({ timeout: 20000 });
  await page.locator('.grid button').first().click();
  await expect(page.getByText('Vota la carta del narrador')).toBeVisible({ timeout: 20000 });
  await page.locator('.grid button:not([disabled])').first().click();
}

// Full solo round against bots
 test('solo con bots juega una ronda completa', async ({ page }) => {
  await registerViaApi(page, makeUser('solo'), 'Tester');
  await page.goto('/');

  await expect(page.locator('#name-input')).toBeVisible({ timeout: 15000 });
  await page.fill('#name-input', 'Tester');
  await page.getByRole('button', { name: 'Solo con bots' }).click();

  await runHumanTurn(page);

  // Pasará por submit/vote automáticamente y llegará a resultados
  await expect(page.getByText('Resultados', { exact: false })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#scoreboard')).toBeVisible();
  const votesBlock = page.getByText('Quién votó a quién', { exact: false });
  await votesBlock.scrollIntoViewIfNeeded();
  await expect(votesBlock).toBeVisible({ timeout: 15000 });

  // Continuar a siguiente ronda para comprobar que no se rompe
  const next = page.locator('#screen-score').getByRole('button', { name: /Continuar/i });
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.locator('#screen-score')).toBeHidden({ timeout: 15000 });
});
