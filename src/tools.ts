import fs from 'fs';
import path from 'path';

export class Tools {
  /**
   * Generate random string id
   *
   * @static
   * @param {number} idLength Length of the generated id
   * @returns {string} randomized id
   */
  static generateId(idLength: number): string {
    let generatedId = '';
    const allowedCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let characterIndex = 0; characterIndex < idLength; characterIndex++) {
      generatedId += allowedCharacters.charAt(Math.floor(Math.random() * allowedCharacters.length));
    }
    return generatedId;
  }

  /**
   * Get tag from module filename
   *
   * @static
   * @param {NodeModule} nodeModule Node module
   * @returns {string} Lowercase module name
   */

  static getTag(nodeModule: NodeModule): string {
    return nodeModule.filename.split('.')[0].split('/').splice(-1)[0].toLowerCase();
  }

  /**
   * Find all files in directory (recursive)
   *
   * @static
   * @param {string} directoryPath Path to recursively search
   * @returns {string[]} Paths of all files found
   */
  static walk(directoryPath: string): string[] {
    let filePaths: string[] = [];
    let directoryEntries = fs.readdirSync(directoryPath);
    directoryEntries = directoryEntries.filter((entry) => !/(^|\/)\.[^/.]/g.test(entry));
    directoryEntries.forEach((entry) => {
      const entryPath = path.join(directoryPath, entry);
      const entryStats = fs.statSync(entryPath);
      if (entryStats && entryStats.isDirectory()) {
        filePaths = filePaths.concat(Tools.walk(entryPath));
      } else {
        filePaths.push(entryPath);
      }
    });
    return filePaths;
  }
}
