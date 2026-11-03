import { io, Socket } from 'socket.io-client';
import { BACKEND_URL } from './api';

let socketInstance: Socket | null = null;

export function getSocket(): Socket {
  if (!socketInstance) {
    const token = typeof window !== 'undefined' ? localStorage.getItem('sys_auth_token') || '' : '';
    socketInstance = io(BACKEND_URL, {
      auth: { token },
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
    });

    socketInstance.on('connect', () => {
      console.log('⚡ [Socket.io] Conectado en tiempo real al backend Pañol');
    });

    socketInstance.on('disconnect', (reason) => {
      console.warn('⚠️ [Socket.io] Desconectado:', reason);
    });
  }

  return socketInstance;
}
