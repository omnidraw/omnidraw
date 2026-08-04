import type {
  TCanvas,
  TMediaFile,
} from '@omnidraw/service-db/model';

export type TCanvasDatabaseCapability = {
  canvas: {
    create(args: Pick<TCanvas, 'id' | 'name'>): Promise<TCanvas>;
    deleteById(args: { id: string }): Promise<TCanvas[]>;
    findById(args: { id: string }): Promise<TCanvas | null>;
    findByName(args: { name: string }): Promise<TCanvas | null>;
    listAll(): Promise<TCanvas[]>;
    renameById(args: { id: string; name: string }): Promise<TCanvas | null>;
  };
};

export type TFileDatabaseCapability = {
  file: {
    create(args: Omit<TMediaFile, 'createdAtSec'>): Promise<TMediaFile>;
    deleteById(args: { id: string }): Promise<void>;
    getById(args: { id: string }): Promise<TMediaFile | null>;
  };
};
