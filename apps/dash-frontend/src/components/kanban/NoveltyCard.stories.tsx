import type { Meta, StoryObj } from '@storybook/react';
import { NoveltyCard } from './NoveltyCard';
import { Usuario } from '../../types/dash';

const usuariosMock: Usuario[] = [
  { id: '1', usuario: 'MATIAS', rol: 'operador' },
  { id: '2', usuario: 'ADMIN', rol: 'admin' },
  { id: '3', usuario: 'TRANSER', rol: 'operador' }
];

const meta: Meta<typeof NoveltyCard> = {
  title: 'DASH Kanban/NoveltyCard',
  component: NoveltyCard,
  tags: ['autodocs'],
  argTypes: {
    onResolver: { action: 'resolved' },
    onEditar: { action: 'edited' },
    onCambiarTerminal: { action: 'terminalChanged' },
    onCambiarServicio: { action: 'serviceChanged' }
  }
};

export default meta;
type Story = StoryObj<typeof NoveltyCard>;

export const LibreCyan: Story = {
  args: {
    usuarios: usuariosMock,
    novedad: {
      id: '101',
      tipo_novedad: 'LIBRES',
      nom: 'GONZALEZ JUAN CARLOS',
      tractor: 'AG123BC',
      srv: 'EURO',
      servicio: 'EURO',
      n_ute: '102',
      cisternado: 'CIST-04',
      terminal: 'DOCK SUD',
      fecha_objetivo: null,
      detalle: 'Disponible en base Dock Sud listo para asignación de viaje.',
      resuelto: false,
      creador: 'OPERADOR',
      timestamp: new Date().toISOString(),
      menciones: ['MATIAS']
    }
  }
};

export const BajaDiagrama: Story = {
  args: {
    usuarios: usuariosMock,
    novedad: {
      id: '102',
      tipo_novedad: 'BAJA_DIAGRAMA',
      nom: 'RODRIGUEZ PEDRO',
      tractor: 'AF987LK',
      srv: 'CM',
      n_ute: '54',
      terminal: 'TPH',
      fecha_objetivo: '2026-10-15',
      detalle: 'Baja programada por franco compensatorio.',
      resuelto: false,
      creador: 'COORDINADOR',
      timestamp: new Date().toISOString(),
      menciones: []
    }
  }
};

export const CertificacionVtvMass: Story = {
  args: {
    usuarios: usuariosMock,
    novedad: {
      id: '103',
      tipo_novedad: 'CERTIFICACION_UNIDAD',
      nom: 'MARTINEZ CARLOS',
      tractor: 'AE444ZZ',
      srv: 'LIVIANO',
      n_ute: '18',
      terminal: 'AÑELO',
      fecha_objetivo: '2026-10-20',
      detalle: '[VTV / MASS]\n\nRenovación obligatoria de técnica anual.',
      resuelto: false,
      creador: 'SEGURIDAD',
      timestamp: new Date().toISOString(),
      menciones: ['TRANSER']
    }
  }
};

export const Resuelto: Story = {
  args: {
    usuarios: usuariosMock,
    novedad: {
      id: '104',
      tipo_novedad: 'REPARACION',
      nom: 'FERNANDEZ LUCAS',
      tractor: 'AD555RT',
      srv: 'TDS',
      n_ute: '07',
      terminal: 'TLC',
      fecha_objetivo: '2026-10-08',
      detalle: 'Frenos reparados y alineación completa en taller oficial.',
      resuelto: true,
      creador: 'TALLER',
      timestamp: new Date().toISOString(),
      menciones: []
    }
  }
};
