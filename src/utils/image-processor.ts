import sharp from 'sharp';

interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  size: number;
}

interface ProcessedImage {
  buffer: Buffer;
  metadata: ImageMetadata;
  resized: boolean;
}

const MIN_DIMENSION = 500;
const MAX_DIMENSION = 4800;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Get image metadata from buffer or URL
 */
export async function getImageMetadata(
  input: Buffer | string
): Promise<ImageMetadata> {
  const metadata = await sharp(input).metadata();
  
  if (!metadata.width || !metadata.height) {
    throw new Error('Unable to determine image dimensions');
  }

  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format || 'jpeg',
    size: metadata.size || 0,
  };
}

/**
 * Process image: validate dimensions, resize if needed, optimize
 */
export async function processImageForUpload(
  input: Buffer | string,
  options?: {
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    format?: 'jpeg' | 'png' | 'webp';
    quality?: number;
  }
): Promise<ProcessedImage> {
  const minWidth = options?.minWidth ?? MIN_DIMENSION;
  const minHeight = options?.minHeight ?? MIN_DIMENSION;
  const maxWidth = options?.maxWidth ?? MAX_DIMENSION;
  const maxHeight = options?.maxHeight ?? MAX_DIMENSION;
  const format = options?.format || 'jpeg';
  const quality = options?.quality || 90;

  // Get metadata
  const metadata = await getImageMetadata(input);
  
  let image = sharp(input);
  let resized = false;

  // Check if resize needed (too small)
  if (metadata.width < minWidth || metadata.height < minHeight) {
    const scale = Math.max(
      minWidth / metadata.width,
      minHeight / metadata.height
    );
    
    const newWidth = Math.round(metadata.width * scale);
    const newHeight = Math.round(metadata.height * scale);
    
    image = image.resize(newWidth, newHeight, {
      fit: 'contain',
      withoutEnlargement: false,
    });
    resized = true;
  }

  // Check if resize needed (too large)
  if (metadata.width > maxWidth || metadata.height > maxHeight) {
    const scale = Math.min(
      maxWidth / metadata.width,
      maxHeight / metadata.height
    );
    
    const newWidth = Math.round(metadata.width * scale);
    const newHeight = Math.round(metadata.height * scale);
    
    image = image.resize(newWidth, newHeight, {
      fit: 'contain',
      withoutEnlargement: true,
    });
    resized = true;
  }

  // Convert to format and optimize
  let processedBuffer: Buffer;
  if (format === 'jpeg') {
    processedBuffer = await image.jpeg({ quality }).toBuffer();
  } else if (format === 'png') {
    processedBuffer = await image.png().toBuffer();
  } else {
    processedBuffer = await image.webp({ quality }).toBuffer();
  }

  // Check file size
  if (processedBuffer.length > MAX_FILE_SIZE) {
    throw new Error(`Image too large: ${(processedBuffer.length / 1024 / 1024).toFixed(2)}MB (max 10MB)`);
  }

  // Get final metadata
  const finalMetadata = await getImageMetadata(processedBuffer);

  return {
    buffer: processedBuffer,
    metadata: finalMetadata,
    resized,
  };
}

/**
 * Validate image meets eBay requirements
 */
export async function validateImageForEbay(
  input: Buffer | string
): Promise<{
  valid: boolean;
  errors: string[];
  metadata: ImageMetadata;
}> {
  const errors: string[] = [];
  
  try {
    const metadata = await getImageMetadata(input);

    // Check minimum dimensions
    if (metadata.width < MIN_DIMENSION || metadata.height < MIN_DIMENSION) {
      errors.push(`Image too small: ${metadata.width}x${metadata.height} (min ${MIN_DIMENSION}px)`);
    }

    // Check maximum dimensions
    if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
      errors.push(`Image too large: ${metadata.width}x${metadata.height} (max ${MAX_DIMENSION}px)`);
    }

    // Check file size
    if (metadata.size > MAX_FILE_SIZE) {
      errors.push(`File too large: ${(metadata.size / 1024 / 1024).toFixed(2)}MB (max 10MB)`);
    }

    return {
      valid: errors.length === 0,
      errors,
      metadata,
    };
  } catch (error) {
    return {
      valid: false,
      errors: [`Failed to process image: ${error instanceof Error ? error.message : 'Unknown error'}`],
      metadata: { width: 0, height: 0, format: 'unknown', size: 0 },
    };
  }
}
