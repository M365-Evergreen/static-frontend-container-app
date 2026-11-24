import {
  FileTrigger,
  Button,
  ListBoxItem,
  NumberField,
  Input,
  Label,
  Slider,
  SliderTrack,
  SliderThumb,
} from "react-aria-components";
import { ToolSelect, ToolCheckbox } from "../components/ToolControls";
import { useState } from "react";
import { ToolPanel, BlobPreview } from "../components/ToolPanel";
import { useToolOperation } from "../useToolOperation";
import { downloadBlob } from "../browserIO";
import { readImage, convertImage, imageFormats } from "./ImageConverter.logic";
import type { ImageFormat } from "./ImageConverter.logic";
import styles from "../BrowserTools.module.css";

export default function ImageConverter() {
  const [format, setFormat] = useState<ImageFormat>("image/webp");
  const [quality, setQuality] = useState(90);
  const [width, setWidth] = useState<string | null>(null);
  const [height, setHeight] = useState<string | null>(null);
  const [locked, setLocked] = useState(true);
  const source = useToolOperation<{ file: File; image: HTMLImageElement }>();
  const operation = useToolOperation<Blob>();
  const targetWidth = Number(width ?? source.result?.image.naturalWidth);
  const targetHeight = Number(height ?? source.result?.image.naturalHeight);
  function selectFile(file: File) {
    setWidth(null);
    setHeight(null);
    operation.clear();
    void source.run(
      async () => ({ file, image: await readImage(file) }),
      file.size,
      (value) => value.file.size,
    );
  }
  function resize(axis: "width" | "height", value: string) {
    if (axis === "width") setWidth(value);
    else setHeight(value);
    const image = source.result?.image;
    const pixels = Number(value);
    if (locked && image && Number.isFinite(pixels) && pixels > 0) {
      if (axis === "width")
        setHeight(
          String(
            Math.max(
              1,
              Math.round((pixels * image.naturalHeight) / image.naturalWidth),
            ),
          ),
        );
      else
        setWidth(
          String(
            Math.max(
              1,
              Math.round((pixels * image.naturalWidth) / image.naturalHeight),
            ),
          ),
        );
    }
    operation.clear();
  }
  return (
    <ToolPanel
      title="Image Converter & Resizer"
      description="Convert local images to PNG, JPEG or WebP using Canvas."
      error={source.error || operation.error}
      busy={source.busy || operation.busy}
      stats={operation.stats}
    >
      <p className={styles.note}>
        JPEG uses a white background for transparency. Animated images become a
        single raster frame; SVG is rasterized. Browser codec and canvas memory
        limits apply. No files are uploaded.
      </p>
      <div
        className={styles.dropzone}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) selectFile(file);
        }}
      >
        <div>
          <FileTrigger
            acceptedFileTypes={"image/*".split(",")}
            onSelect={(files) => {
              const file = files?.[0];
              if (file) selectFile(file);
            }}
          >
            <Button>
              <>Choose an image, or drop it here</>
            </Button>
          </FileTrigger>
        </div>
      </div>
      <div className={styles.toolbar}>
        <ToolSelect
          selectedKey={String(format)}
          onSelectionChange={(selectedValue) => {
            const next = imageFormats.find((item) => item === selectedValue);
            if (next) {
              setFormat(next);
              operation.clear();
            }
          }}
          label={<>Output format</>}
        >
          {imageFormats.map((item) => (
            <ListBoxItem id={String(item)} key={item}>
              {item}
            </ListBoxItem>
          ))}
        </ToolSelect>
        {format !== "image/png" && (
          <Slider
            className={styles.field}
            minValue={10}
            maxValue={100}
            value={quality}
            onChange={(value) => {
              setQuality(value);
              operation.clear();
            }}
          >
            <Label>Quality ({quality}%)</Label>
            <SliderTrack className={styles.sliderTrack}>
              <SliderThumb className={styles.sliderThumb} />
            </SliderTrack>
          </Slider>
        )}
        <NumberField
          className={styles.field}
          minValue={1}
          step={1}
          isDisabled={!source.result}
          value={width === "" ? NaN : targetWidth}
          onChange={(value) =>
            resize("width", Number.isNaN(value) ? "" : String(value))
          }
          formatOptions={{ useGrouping: false }}
        >
          <Label>Width (pixels)</Label>
          <Input />
        </NumberField>
        <NumberField
          className={styles.field}
          minValue={1}
          step={1}
          isDisabled={!source.result}
          value={height === "" ? NaN : targetHeight}
          onChange={(value) =>
            resize("height", Number.isNaN(value) ? "" : String(value))
          }
          formatOptions={{ useGrouping: false }}
        >
          <Label>Height (pixels)</Label>
          <Input />
        </NumberField>
        <ToolCheckbox
          className={styles.checkbox}
          isSelected={locked}
          onChange={(selected) => {
            setLocked(selected);
            if (selected && source.result && targetWidth > 0)
              setHeight(
                String(
                  Math.max(
                    1,
                    Math.round(
                      (targetWidth * source.result.image.naturalHeight) /
                        source.result.image.naturalWidth,
                    ),
                  ),
                ),
              );
            operation.clear();
          }}
        >
          <>Lock aspect ratio</>
        </ToolCheckbox>
        <Button
          isDisabled={!source.result || source.busy || operation.busy}
          onPress={() => {
            if (source.result) {
              const { file, image } = source.result;
              void operation.run(
                () =>
                  convertImage(
                    image,
                    targetWidth,
                    targetHeight,
                    format,
                    quality,
                  ),
                file.size,
                (value) => value.size,
              );
            }
          }}
        >
          Convert image
        </Button>
        <Button
          onPress={() => {
            source.clear();
            operation.clear();
            setWidth(null);
            setHeight(null);
          }}
        >
          Clear image
        </Button>
      </div>
      <div className={styles.grid}>
        <div className={styles.pane}>
          <h3>Source image</h3>
          {source.result ? (
            <>
              <p>
                {source.result.file.name} | {source.result.image.naturalWidth} x{" "}
                {source.result.image.naturalHeight} |{" "}
                {source.result.file.size.toLocaleString()} bytes
              </p>
              <BlobPreview
                blob={source.result.file}
                kind="image"
                label="Original image"
              />
            </>
          ) : (
            <p>Select a local image to begin.</p>
          )}
        </div>
        <div className={styles.pane}>
          <h3>Converted image</h3>
          {operation.result ? (
            <>
              <p>
                {targetWidth} x {targetHeight} |{" "}
                {operation.result.size.toLocaleString()} bytes
              </p>
              <BlobPreview
                blob={operation.result}
                kind="image"
                label="Converted image"
              />
              <Button
                onPress={() => {
                  if (!operation.result) return;
                  const extension =
                    format === "image/jpeg" ? "jpg" : format.split("/")[1];
                  const name =
                    source.result?.file.name.replace(/\.[^.]+$/, "") || "image";
                  try {
                    downloadBlob(
                      operation.result,
                      `${name}-converted.${extension}`,
                    );
                  } catch {
                    operation.fail(
                      "Could not download. Check browser download permissions.",
                    );
                  }
                }}
              >
                Download image
              </Button>
            </>
          ) : (
            <p>Convert the image to see the result.</p>
          )}
        </div>
      </div>
    </ToolPanel>
  );
}
