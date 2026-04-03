import { Router } from 'express';
import * as clientesController from '../controllers/clientes.controller';
import * as notasController from '../controllers/notas-cliente.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Listar clientes con filtros
router.get('/', authenticateToken, clientesController.getClientes);

// Buscar clientes (endpoint específico para búsqueda rápida)
router.get('/buscar', authenticateToken, clientesController.buscarClientes);

// Obtener pasajeros de un cliente
router.get('/:id/pasajeros', authenticateToken, clientesController.getPasajerosByCliente);

// Obtener cliente por ID (debe ir DESPUÉS de rutas específicas)
router.get('/:id', authenticateToken, clientesController.getClienteById);

// Crear nuevo cliente
router.post('/', authenticateToken, clientesController.createCliente);

// Actualizar cliente
router.put('/:id', authenticateToken, clientesController.updateCliente);

// Agregar pasajero a cliente
router.post('/:id/pasajeros', authenticateToken, clientesController.addPasajero);

// Notas del cliente
router.get('/:cliente_id/notas', authenticateToken, notasController.getNotasByCliente);
router.post('/:cliente_id/notas', authenticateToken, notasController.createNota);
router.put('/notas/:id', authenticateToken, notasController.updateNota);
router.delete('/notas/:id', authenticateToken, notasController.deleteNota);

export default router;
