import { test, expect, chromium } from '@playwright/test';

// Multiuser flow: host creates, guest joins by código (sin guion), host añade bot y arranca
// Requiere servidor en 3000 (Playwright config ya lo levanta)
test('multijugador: unirse con código, añadir bot y arrancar partida', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  // Host crea sala
  await host.goto('/');
  await host.fill('#name-input', 'Host');
  await host.getByRole('button', { name: 'Unirse / Crear' }).click();
  await expect(host.getByText('Lobby de Partida')).toBeVisible();

  // Capturar código (AAA-111)
  const codeEl = host.getByText(/^[A-Z]{3}-\d{3}$/).first();
  const roomCode = (await codeEl.innerText()).trim();

  // Invitado se une escribiendo código sin guion para probar formateo automático
  await guest.goto('/');
  await guest.fill('#name-input', 'Invitado');
  await guest.fill('#room-input', roomCode.replace('-', ''));
  await expect(guest.locator('#room-input')).toHaveValue(roomCode);
  await guest.getByRole('button', { name: 'Unirse / Crear' }).click();

  // Host ve al invitado
  await expect(host.getByText('Invitado', { exact: true })).toBeVisible({ timeout: 10000 });

  // Host añade bot y arranca
  await host.getByRole('button', { name: 'Añadir bot' }).click();
  await host.getByRole('button', { name: 'Empezar' }).click();

  // Host como narrador: elige carta y envía pista
  await expect(host.getByText('Elige una carta y escribe tu pista')).toBeVisible({ timeout: 15000 });
  await host.locator('#clue-hand div').first().click();
  await host.fill('#clue-input', 'misterio');
  await host.getByRole('button', { name: 'Enviar' }).click();

  // Invitado envía carta
  await expect(guest.getByText('Elige la carta que más encaje')).toBeVisible({ timeout: 15000 });
  await guest.locator('.grid button').first().click();

  // Invitado vota (elige cualquier carta disponible que no sea la suya)
  await expect(guest.getByText('Vota la carta del narrador')).toBeVisible({ timeout: 15000 });
  await guest.locator('.grid button:not([disabled])').first().click();

  // Esperar resultados en ambos
  await expect(host.getByText('Resultados')).toBeVisible({ timeout: 20000 });
  await expect(guest.getByText('Resultados')).toBeVisible({ timeout: 20000 });

  await hostContext.close();
  await guestContext.close();
});
