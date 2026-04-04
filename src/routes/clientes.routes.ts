import { Router } from 'express';
import * as clientesController from '../controllers/clientes.controller';
import * as notasController from '../controllers/notas-cliente.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Listar clientes con filtros
router.get('/', authenticateToken, clientesController.getClientes);

// Buscar clientes (endpoint específico para búsqueda rápida)
router.get('/buscar', authenticateToken, clientesController.buscarClientes);

// ============================================
// RUTAS ESPECÍFICAS (deben ir ANTES de /:id)
// ============================================

// Notas del cliente
router.get('/:id/notas', authenticateToken, notasController.getNotasByCliente);
router.post('/:id/notas', authenticateToken, notasController.createNota);

// Pasajeros del cliente
router.get('/:id/pasajeros', authenticateToken, clientesController.getPasajerosByCliente);
router.post('/:id/pasajeros', authenticateToken, clientesController.addPasajero);

// Notas - update y delete (rutas planas sin nested params)
router.put('/notas/:id', authenticateToken, notasController.updateNota);
router.delete('/notas/:id', authenticateToken, notasController.deleteNota);

// ============================================
// RUTAS GENÉRICAS /:id (deben ir al FINAL)
// ============================================

// Obtener cliente por ID
router.get('/:id', authenticateToken, clientesController.getClienteById);

// Crear nuevo cliente
router.post('/', authenticateToken, clientesController.createCliente);

// Actualizar cliente
router.put('/:id', authenticateToken, clientesController.updateCliente);

export default router;
