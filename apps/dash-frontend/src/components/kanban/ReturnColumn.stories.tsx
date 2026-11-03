import type { Meta, StoryObj } from '@storybook/react';
import { ReturnColumn } from './ReturnColumn';
import { RetornoItem, FlotaItem } from '../../types/dash';

const retornosMock: RetornoItem[] = [
  {
    nom: 'ALVAREZ MIGUEL',
    tractor: 'AG777CC',
    retorna_cuando: 'HOY',
    codigo_ayer: 'F',
    codigo_hoy: '-',
    codigo_manana: '-'
  },
  {
    nom: 'BENITEZ RAMIRO',
    tractor: 'AF321MN',
    retorna_cuando: 'HOY',
    codigo_ayer: 'V',
    codigo_hoy: '-',
    codigo_manana: '-'
  },
  {
    nom: 'CASTRO DANIEL',
    tractor: 'AD111OP',
    retorna_cuando: 'MANANA',
    codigo_ayer: 'S',
    codigo_hoy: 'F',
    codigo_manana: '-'
  }
];

const flotaMock: FlotaItem[] = [];

const meta: Meta<typeof ReturnColumn> = {
  title: 'DASH Kanban/ReturnColumn',
  component: ReturnColumn,
  tags: ['autodocs']
};

export default meta;
type Story = StoryObj<typeof ReturnColumn>;

export const Default: Story = {
  args: {
    retornos: retornosMock,
    flota: flotaMock,
    flexWeight: 1
  }
};
