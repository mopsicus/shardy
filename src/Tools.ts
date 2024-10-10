import fs from 'fs';
import path from 'path';

export class Tools {
  /**
   * Generate random string id
   *
   * @static
   * @param {number} length Length for string
   * @returns {string} randomized id
   */
  static generateId(length: number): string {
    let id = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
      id += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return id;
  }

  /**
   * Get tag from module filename
   *
   * @static
   * @param {NodeModule} item Node module
   * @return {*} {string} short name lowercased
   */

  static getTag(item: NodeModule): string {
    return item.filename.split('.')[0].split('/').splice(-1)[0].toLowerCase();
  }

  /**
   * Find all files in directory (recursive)
   *
   * @static
   * @param {string} directory Path to begin walk and find
   * @return {*}  {string[]} Array of paths
   */
  static walk(directory: string): string[] {
    let results: string[] = [];
    let list = fs.readdirSync(directory);
    list = list.filter((item) => !/(^|\/)\.[^/.]/g.test(item));
    list.forEach((file) => {
      file = path.join(directory, file);
      const stat = fs.statSync(file);
      if (stat && stat.isDirectory()) {
        results = results.concat(Tools.walk(file));
      } else {
        results.push(file);
      }
    });
    return results;
  }
}
