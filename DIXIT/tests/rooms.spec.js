import { test, expect } from '@playwright/test';

async function createRoomQuick(page, name) {
  await page.goto('/');
  await page.fill('#name-input', name);
  await page.getByTitle('Crear sala rápida').click();
  await expect(page.getByText('Lobby de Partida')).toBeVisible();
  const code = (await page.getByText(/^[A-Z]{3}-\d{3}$/).first().innerText()).trim();
  return code;
}

test('vista de salas permite seleccionar múltiples salas y eliminarlas', async ({ browser }) => {
  const hostContextA = await browser.newContext();
  const hostContextB = await browser.newContext();
  const adminContext = await browser.newContext();

  const hostA = await hostContextA.newPage();
  const hostB = await hostContextB.newPage();
  const admin = await adminContext.newPage();

  const roomA = await createRoomQuick(hostA, 'HostA');
  const roomB = await createRoomQuick(hostB, 'HostB');

  await admin.goto('/');
  await admin.fill('#name-input', 'Admin');
  await admin.getByTitle('Ver salas').click();
  await expect(admin.getByText('Salas activas')).toBeVisible();

  await expect(admin.getByTestId(`room-card-${roomA}`)).toBeVisible();
  await expect(admin.getByTestId(`room-card-${roomB}`)).toBeVisible();

  await admin.getByTestId(`select-room-${roomA}`).check();
  await admin.getByTestId(`select-room-${roomB}`).check();

  const bulkDelete = admin.getByTestId('delete-selected-rooms');
  await expect(bulkDelete).toBeEnabled();
  await expect(bulkDelete).toContainText('(2)');

  admin.on('dialog', async (dialog) => {
    if (dialog.type() === 'prompt') {
      await dialog.accept('hola123');
      return;
    }
    await dialog.accept();
  });

  await bulkDelete.click();
  await expect(admin.getByTestId(`room-card-${roomA}`)).toHaveCount(0, { timeout: 12000 });
  await expect(admin.getByTestId(`room-card-${roomB}`)).toHaveCount(0, { timeout: 12000 });

  await hostContextA.close();
  await hostContextB.close();
  await adminContext.close();
});
