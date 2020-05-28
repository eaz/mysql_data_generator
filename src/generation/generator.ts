import { Randomizer } from './randomizer';
import { DatabaseConnector } from '../database/database-connector-builder';
import { uuid4, MersenneTwister19937 } from 'random-js';
import { Schema } from '../schema.interface';
import { TableDescriptor } from '../table-descriptor.interface';

type RequireAtLeastOne<T, Keys extends keyof T = keyof T> =
    Pick<T, Exclude<keyof T, Keys>>
    & {
        [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>
    }[Keys];

interface BaseTable {
    name: string;
    /** @deprecated: This parameter has been renamed maxLines */
    lines?: number;
    columns: Column[];
    before?: string[];
    after?: string[];
    maxLines?: number;
    addLines?: number;
}

export type Table = RequireAtLeastOne<BaseTable, 'maxLines' | 'addLines'>;

export class Generator {
    constructor(
        private dbConnector: DatabaseConnector,
        private schema: Schema,
    ) { }

    private async empty(table: TableDescriptor) {
        console.log('empty: ', table.name);
        await this.dbConnector.emptyTable(table);
    }

    private async getForeignKeyValues(table: TableDescriptor, tableForeignKeyValues: { [key: string]: any[]; } = {}, runRows: number) {
        for (var c = 0; c < table.columns.length; c++) {
            const column = table.columns[c];
            if (column.foreignKey) {
                const foreignKey = column.foreignKey;
                let values = await this.dbConnector.getValuesForForeignKeys(
                    table.name,
                    column.name,
                    column.foreignKey.table,
                    column.foreignKey.column,
                    runRows,
                    column.options.unique,
                    column.foreignKey.where,
                );
                if (values.length === 0 && !column.options.nullable) {
                    throw new Error(`${table}: Not enough values available for foreign key ${foreignKey.table}.${foreignKey.column}`);
                }
                tableForeignKeyValues[`${column.name}_${foreignKey.table}_${foreignKey.column}`] = values;
            }
        }
    }

    public async fill(table: TableDescriptor, reset: boolean) {
        if (reset) await this.empty(table);
        console.log('fill: ', table.name);
        if (this.before) await this.before(table);
        await this.generateData(table);
        await this.after(table);
    }

    private async before(table: TableDescriptor) {
        if (!table.before) return;

        for (const query of table.before) {
            await this.dbConnector.executeRawQuery(query);
        }
    }

    private async generateData(table: TableDescriptor) {
        const tableForeignKeyValues: { [key: string]: any[]; } = {};

        let previousRunRows: number = -1;

        let currentNbRows: number = await this.dbConnector.countLines(table);
        let maxLines = 0;
        if (table.addLines) {
            maxLines = currentNbRows + table.addLines;
            if (table.maxLines) maxLines = Math.min(maxLines, table.maxLines);
        }
        else if (table.maxLines) maxLines = table.maxLines;
        batch: while (currentNbRows < maxLines) {
            previousRunRows = currentNbRows;

            const rows = [];
            const runRows = Math.min(1000, maxLines - currentNbRows);

            try {
                await this.getForeignKeyValues(table, tableForeignKeyValues, runRows);
            } catch (ex) {
                console.warn(ex.message);
                break batch;
            }

            for (let i = 0; i < runRows; i++) {
                const row: { [key: string]: any; } = {};
                for (var c = 0; c < table.columns.length; c++) {
                    const column = table.columns[c];
                    if (column.options.autoIncrement) continue;
                    if (column.values) {
                        if (Array.isArray(column.values)) {
                            row[column.name] = column.values[Randomizer.randomInt(0, column.values.length - 1)];
                        } else if (typeof column.values === 'string') {
                            row[column.name] = this.schema.values[column.values][Randomizer.randomInt(0, this.schema.values[column.values].length - 1)];
                        } else {
                            let valuesWithRatio: string[] = [];
                            Object.keys(column.values).forEach((key: string) => {
                                let arr = new Array((column.values as any)[key]);
                                arr = arr.fill(key);
                                valuesWithRatio = valuesWithRatio.concat(arr);
                            });
                            row[column.name] = valuesWithRatio[Randomizer.randomInt(0, valuesWithRatio.length - 1)];
                        }
                        continue;
                    }
                    if (column.foreignKey) {
                        const foreignKeys = tableForeignKeyValues[`${column.name}_${column.foreignKey.table}_${column.foreignKey.column}`];
                        row[column.name] = foreignKeys[i];
                        continue;
                    }
                    switch (column.generator) {
                        case 'bit':
                            row[column.name] = Randomizer.randomBit(column.options.max);
                            if (column.options.nullable && Math.random() <= 0.1) row[column.name] = null;
                            break;
                        case 'tinyint':
                            row[column.name] = Randomizer.randomInt(column.options.min, column.options.max);
                            if (column.options.nullable && Math.random() <= 0.1) row[column.name] = null;
                            break;
                        case 'bool':
                        case 'boolean':
                            row[column.name] = Randomizer.randomInt(0, 1);
                            if (column.options.nullable && Math.random() <= 0.1) row[column.name] = null;
                            break;
                        case 'smallint':
                            row[column.name] = Randomizer.randomInt(column.options.min, column.options.max);
                            if (column.options.nullable && Math.random() <= 0.1) row[column.name] = null;
                            break;
                        case 'mediumint':
                            row[column.name] = Randomizer.randomInt(column.options.min, column.options.max);
                            if (column.options.nullable && Math.random() <= 0.1) row[column.name] = null;
                            break;
                        case 'int':
                        case 'integer':
                        case 'bigint':
                            row[column.name] = Randomizer.randomInt(column.options.min, column.options.max);
                            if (column.options.nullable && Math.random() <= 0.1) row[column.name] = null;
                            break;
                        case 'decimal':
                        case 'dec':
                        case 'float':
                        case 'double':
                            row[column.name] = Randomizer.randomFloat(column.options.min, column.options.max);
                            if (column.options.nullable && Math.random() <= 0.1) row[column.name] = null;
                            break;
                        case 'date':
                        case 'datetime':
                        case 'timestamp':
                            const min = column.options.min ? new Date(column.options.min) : new Date('01-01-1970');
                            const max = column.options.max ? new Date(column.options.max) : new Date();
                            row[column.name] = Randomizer.randomDate(min, max);
                            if (column.options.nullable && Math.random() <= 0.1) row[column.name] = null;
                            break;
                        case 'time':
                            const hours = Randomizer.randomInt(-838, +838);
                            const minutes = Randomizer.randomInt(-0, +59);
                            const seconds = Randomizer.randomInt(-0, +59);
                            row[column.name] = `${hours}:${minutes}:${seconds}`;
                            if (column.options.nullable && Math.random() <= 0.1) row[column.name] = null;
                            break;
                        case 'year':
                            row[column.name] = Randomizer.randomInt(column.options.min, column.options.max);
                            if (column.options.nullable && Math.random() <= 0.1) row[column.name] = null;
                            break;
                        case 'varchar':
                        case 'char':
                        case 'binary':
                        case 'varbinary':
                            if (column.options.max >= 36 && column.options.unique) {
                                row[column.name] = uuid4(MersenneTwister19937.autoSeed());
                            } else {
                                row[column.name] = Randomizer.randomString(Randomizer.randomInt(column.options.min as number, Math.min(this.schema.maxCharLength, column.options.max)));
                                if (column.options.nullable && Math.random() <= 0.1) row[column.name] = null;
                            }
                            break;
                        case 'tinyblob':
                            row[column.name] = Randomizer.randomString(Randomizer.randomInt(0, 10));
                            if (column.options.nullable && Math.random() <= 0.1) row[column.name] = null;
                            break;
                        case 'text':
                        case 'mediumtext':
                        case 'longtext':
                            row[column.name] = Randomizer.randomString(Randomizer.randomInt(0, Math.min(this.schema.maxCharLength, column.options.max)));
                            if (column.options.nullable && Math.random() <= 0.1) row[column.name] = null;
                            break;
                        case 'blob':
                        case 'mediumblob': // 16777215
                        case 'longblob': // 4,294,967,295
                            row[column.name] = Randomizer.randomString(Randomizer.randomInt(0, Math.min(this.schema.maxCharLength, column.options.max)));
                            if (column.options.nullable && Math.random() <= 0.1) row[column.name] = null;
                            break;
                        case 'set':
                            row[column.name] = Randomizer.randomBit(column.options.max);
                            if (column.options.nullable && Math.random() <= 0.1) row[column.name] = null;
                            break;
                        case 'enum':
                            if (column.options.nullable) {
                                row[column.name] = Math.floor(Math.random() * (column.options.max + 1));
                            } else {
                                row[column.name] = Math.floor(Math.random() * (column.options.max)) + 1;
                            }
                            break;
                    }
                }
                rows.push(row);
            }
            currentNbRows += await this.dbConnector.insert(table.name, rows);
            if (previousRunRows === currentNbRows) {
                console.warn(`Last run didn't insert any new rows in ${table.name}`);
                break batch;
            }
            console.log(currentNbRows + ' / ' + table.maxLines);
        }
    }

    private async after(table: TableDescriptor) {
        if (!table.after) return;

        for (const query of table.after) {
            await this.dbConnector.executeRawQuery(query);
        }
    }
}