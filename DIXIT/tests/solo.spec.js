import { test, expect } from '@playwright/test';

const name = 'Tester';

// Full solo round against bots
 test('solo con bots juega una ronda completa', async ({ page }) => {
  await page.goto('/');
  await page.fill('#name-input', name);
  await page.getByRole('button', { name: 'Solo con bots' }).click();

  // Narrador: elegir carta y pista
  await expect(page.getByText('Elige una carta y escribe tu pista')).toBeVisible({ timeout: 30000 });
  const firstCard = page.locator('#clue-hand div').first();
  await firstCard.click();
  await page.fill('#clue-input', 'pista de prueba');
  await page.getByRole('button', { name: 'Enviar' }).click();

  // Pasará por submit/vote automáticamente y llegará a resultados
  await expect(page.getByText('Resultados', { exact: false })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#scoreboard')).toBeVisible();
  const votesBlock = page.getByText('Quién votó a quién', { exact: false });
  await votesBlock.scrollIntoViewIfNeeded();
  await expect(votesBlock).toBeVisible({ timeout: 15000 });

  // Continuar a siguiente ronda para comprobar que no se rompe
  const next = page.getByRole('button', { name: /Siguiente ronda/i });
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.locator('#screen-score')).toBeHidden({ timeout: 15000 });
});
