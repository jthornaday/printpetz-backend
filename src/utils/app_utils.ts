/**
 * Remove unwanted fields from an object
 * @param data - The object to remove unwanted fields from
 * @param unwantedFields - The fields to remove
 * @returns The object with the unwanted fields removed
 * @example
 * const data = { name: "John", age: 25 };
 * const unwantedFields = ["age"];
 * const result = removeUnwantedData(data, unwantedFields);
 */
export const removeUnwantedData = (data, unwantedFields: string[]) => {
  unwantedFields.forEach((field) => {
    delete data[field];
  });

  return data;
};

/**
 * Remove all fields from an object except the specified fields
 * @param data - The object to remove all fields from
 * @param filteredFields - The fields to keep
 * @returns The object with all fields removed except the specified fields
 * @example
 * const data = { name: "John", age: 25 };
 * const filteredFields = ["name"];
 * const result = removeRestFields(data, filteredFields);
 */
export const removeRestFields = (data: object, filteredFields: string[]) => {
  return filteredFields.reduce((result, field) => {
    if (data[field]) {
      result[field] = data[field];
    }
    return result;
  }, {});
};

/**
 * Construct a Buffer from an array of base64-encoded strings
 * @param chunks - The array of base64-encoded strings
 * @returns A Buffer containing the concatenated data from the base64-encoded strings
 * @example
 * const chunks = ["SGVsbG8=", "IFdvcmxkIQ=="];
 * const buffer = constructBufferFromBase64Chunks(chunks);
 * "Hello World!"
 **/
export const constructBufferFromBase64Chunks = (chunks: string[]) => {
  const buffers: Buffer[] = chunks
    .filter((chunk) => chunk)
    .map((chunk) => Buffer.from(chunk, "base64"));

  return Buffer.concat(buffers);
};

export const capitalizeFistCharacter = (input: string) => {
  return input
    .split(" ")
    .map((str) => str.charAt(0).toUpperCase() + str.slice(1))
    .join(" ");
};

export const wait = (sec: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, sec * 1000);
  });
};

export const removeDuplicates = <T>(arr: T[], key?: string): T[] => {
  const seen = new Set();
  return arr.filter((item) => {
    const finalKey = key ? item[key] : item.toString();
    if (seen.has(finalKey.toLowerCase())) {
      return false;
    }
    seen.add(finalKey.toLowerCase());
    return true;
  });
};

export const getRandomItemFromList = <T>(arr: T[]): T => {
  if (arr.length === 0) {
    return null; // or throw error depending on your use case
  }

  const randomIndex = Math.floor(Math.random() * arr.length);
  return arr[randomIndex];
};
