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

async function waitForNarrator(host, guest) {
  for (let i = 0; i < 80; i += 1) {
    const hostIsNarrator = await host.locator('#clue-input').isVisible().catch(() => false);
    if (hostIsNarrator) {
      return { narrator: host, voter: guest };
    }
    const guestIsNarrator = await guest.locator('#clue-input').isVisible().catch(() => false);
    if (guestIsNarrator) {
      return { narrator: guest, voter: host };
    }
    await host.waitForTimeout(250);
  }
  throw new Error('No se detectó narrador humano en el tiempo esperado.');
}

// Multiuser flow: host creates, guest joins by código (sin guion), host añade bot y arranca
test('multijugador: unirse con código, añadir bot y arrancar partida', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await registerViaApi(host, makeUser('host'), 'Host');
  await registerViaApi(guest, makeUser('guest'), 'Invitado');

  // Host crea sala
  await host.goto('/');
  await expect(host.locator('#name-input')).toBeVisible({ timeout: 15000 });
  await host.fill('#name-input', 'Host');
  await host.locator('button[aria-label="Unirse / Crear"]').click();
  await expect(host.getByText('Lobby de Partida')).toBeVisible();

  // Capturar código (AAA-111)
  const codeEl = host.getByText(/^[A-Z]{3}-\d{3}$/).first();
  const roomCode = (await codeEl.innerText()).trim();

  // Invitado se une escribiendo código sin guion para probar formateo automático
  await guest.goto('/');
  await expect(guest.locator('#name-input')).toBeVisible({ timeout: 15000 });
  await guest.fill('#name-input', 'Invitado');
  const guestJoinButton = guest.locator('button[aria-label="Unirse / Crear"]');
  if (await guest.locator('#room-input').isVisible().catch(() => false)) {
    await guest.fill('#room-input', roomCode.replace('-', ''));
    if (await guestJoinButton.isVisible().catch(() => false)) {
      await guestJoinButton.click();
    }
  }
  await expect(guest.getByText('Lobby de Partida')).toBeVisible({ timeout: 15000 });

  // Host ve al invitado
  await expect(host.getByText('Invitado', { exact: true })).toBeVisible({ timeout: 10000 });

  // Host añade bot y arranca
  await host.getByRole('button', { name: 'Añadir bot' }).click();
  await host.getByRole('button', { name: 'Empezar' }).click();

  const { narrator, voter } = await waitForNarrator(host, guest);

  // Narrador: elige carta y envía pista
  await narrator.locator('#clue-hand div').first().click();
  await narrator.fill('#clue-input', 'misterio');
  await narrator.getByRole('button', { name: 'Enviar' }).click();

  // Votante humano envía carta y vota
  await expect(voter.getByText('Elige la carta que más encaje')).toBeVisible({ timeout: 20000 });
  await voter.locator('.grid button').first().click();
  await expect(voter.getByText('Vota la carta del narrador')).toBeVisible({ timeout: 20000 });
  await voter.locator('.grid button:not([disabled])').first().click();

  // Esperar resultados en ambos
  await expect(host.getByText('Resultados')).toBeVisible({ timeout: 20000 });
  await expect(guest.getByText('Resultados')).toBeVisible({ timeout: 20000 });

  await hostContext.close();
  await guestContext.close();
});
