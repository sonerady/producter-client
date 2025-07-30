import React, { useRef, useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import { GoogleGenAI } from "@google/genai";
import ReactCompareImage from "react-compare-image";
import "./App.css";

const GEMINI_API_KEY = process.env.REACT_APP_GEMINI_API_KEY || "";

function getCroppedImg(
  imageSrc: string,
  croppedAreaPixels: any,
  outputSize = 1024
): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.src = imageSrc;
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject();

      // Canvas'ı square yapalım
      canvas.width = outputSize;
      canvas.height = outputSize;

      // Temiz beyaz arkaplan
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, outputSize, outputSize);

      // Kırpılan alanın boyutlarını al (pixelCrop zaten doğru pixel değerleri)
      const { x, y, width, height } = croppedAreaPixels;

      // Görseli kırpılmış halde çiz - tam canvas boyutunda
      ctx.drawImage(
        image,
        x,
        y,
        width,
        height, // source: kırpılan alan
        0,
        0,
        outputSize,
        outputSize // destination: canvas'ın tamamı
      );

      resolve(canvas.toDataURL("image/jpeg", 0.95));
    };

    image.onerror = reject;
  });
}

// Yeni fonksiyon: Bir görseli 5000x5000 canvas'a ortalar
async function fitImageToCanvas5000(imageUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject();
      canvas.width = 5000;
      canvas.height = 5000;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 5000, 5000);
      // Aspect ratio koruyarak boyutlandır
      const scale = Math.min(5000 / img.width, 5000 / img.height);
      const drawWidth = img.width * scale;
      const drawHeight = img.height * scale;
      const x = (5000 - drawWidth) / 2;
      const y = (5000 - drawHeight) / 2;
      ctx.drawImage(img, x, y, drawWidth, drawHeight);
      resolve(canvas.toDataURL("image/png", 0.95));
    };
    img.onerror = reject;
  });
}

function App() {
  const [image, setImage] = useState<string | null>(null);
  const [croppedImage, setCroppedImage] = useState<string | null>(null);
  const [showCrop, setShowCrop] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [prompt, setPrompt] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [processes, setProcesses] = useState<
    Array<{
      id: string;
      originalImage: string;
      status: "processing" | "completed" | "error";
      resultUrl?: string;
      error?: string;
      timestamp: number;
    }>
  >([]);
  const [showImageModal, setShowImageModal] = useState(false);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string>("");
  const [selectedOriginalImage, setSelectedOriginalImage] =
    useState<string>("");
  const [isPngModal, setIsPngModal] = useState(false);
  const [preservePose, setPreservePose] = useState(true);
  const [pngProcesses, setPngProcesses] = useState<
    Array<{
      id: string;
      originalImageUrl: string;
      status: "processing" | "completed" | "error";
      resultUrl?: string;
      error?: string;
      timestamp: number;
    }>
  >([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setImage(ev.target?.result as string);
        setShowCrop(true);
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const onCropComplete = useCallback((_: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleCropSave = async () => {
    if (image && croppedAreaPixels) {
      const cropped = await getCroppedImg(image, croppedAreaPixels, 1024);
      setCroppedImage(cropped);
      setShowCrop(false);
    }
  };

  const handleImageClick = (imageUrl: string, originalImage: string) => {
    setSelectedImageUrl(imageUrl);
    setSelectedOriginalImage(originalImage);
    setIsPngModal(false);
    setShowImageModal(true);
  };

  const handlePngImageClick = (imageUrl: string) => {
    setSelectedImageUrl(imageUrl);
    setIsPngModal(true);
    setShowImageModal(true);
  };

  const closeImageModal = () => {
    setShowImageModal(false);
    setSelectedImageUrl("");
    setSelectedOriginalImage("");
    setIsPngModal(false);
  };

  const handleDownload = async (imageUrl: string) => {
    try {
      // 5000x5000 canvas'a oturtulmuş halini indir
      const dataUrl = await fitImageToCanvas5000(imageUrl);
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `retouch-result-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("İndirme hatası:", err);
    }
  };

  async function sendToReplicate(prompt: string, imageBase64: string) {
    const url = "https://producter-server.onrender.com/replicate";
    const body = {
      prompt,
      input_image: imageBase64,
    };

    console.log("🚀 Sending to proxy server...");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    console.log("📨 Proxy response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Proxy error response:", errorText);
      throw new Error("Replicate API hatası: " + errorText);
    }

    const jsonResponse = await response.json();
    console.log("📦 Proxy JSON response:", jsonResponse);

    return jsonResponse;
  }

  async function sendToBackgroundRemover(imageUrl: string) {
    const url = "https://producter-server.onrender.com/background-remover";
    const body = {
      image_url: imageUrl,
    };

    console.log("🖼️ Sending to background remover proxy server...");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    console.log(
      "📨 Background remover proxy response status:",
      response.status
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Background remover proxy error response:", errorText);
      throw new Error("Background remover API hatası: " + errorText);
    }

    const jsonResponse = await response.json();
    console.log("📦 Background remover proxy JSON response:", jsonResponse);

    return jsonResponse;
  }

  async function sendToIncreaseResolution(imageUrl: string) {
    const url = "https://producter-server.onrender.com/increase-resolution";
    const body = {
      image_url: imageUrl,
    };

    console.log("🔍 Sending to increase resolution proxy server...");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    console.log(
      "📨 Increase resolution proxy response status:",
      response.status
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Increase resolution proxy error response:", errorText);
      throw new Error("Increase resolution API hatası: " + errorText);
    }

    const jsonResponse = await response.json();
    console.log("📦 Increase resolution proxy JSON response:", jsonResponse);

    return jsonResponse;
  }

  const handleCreate = async () => {
    if (!croppedImage) return;
    setError("");

    // 2 paralel process oluştur
    const processId1 = Date.now().toString();
    const processId2 = (Date.now() + 1).toString();

    const newProcess1 = {
      id: processId1,
      originalImage: croppedImage,
      status: "processing" as const,
      timestamp: Date.now(),
    };

    const newProcess2 = {
      id: processId2,
      originalImage: croppedImage,
      status: "processing" as const,
      timestamp: Date.now() + 1,
    };

    setProcesses((prev) => [newProcess1, newProcess2, ...prev]);

    // Tek Gemini promptu oluştur
    const generatePrompt = async () => {
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const model = "gemini-2.0-flash";
      const contents = [
        {
          role: "user",
          parts: [
            {
              text: `You are an expert jewelry retouch prompt generator for AI editing. For every uploaded jewelry image, analyze the piece (type: ring, earring, necklace, bracelet, pendant, perfume bottle, bag etc.), its materials (gold, silver, platinum, gemstones, enamel, pearls, leather, etc.), colors, shapes and textures. Then write a detailed, professional prompt for retouching the photo into a high-end, luxury catalog-quality studio shot.

The prompt you generate must always begin with:

Retouch the jewelry photo to look like a professional high-end studio shot: clean white background, increased brilliance and clarity in gemstones, polished metal surfaces with realistic reflections, no dust or scratches, perfect lighting and shadow. Remove any blurriness or focus issues; ensure all details are sharp and perfectly in focus.

${
  preservePose
    ? `If pose preservation is enabled, add this instruction:
Keep the current pose and perspective exactly as shown. Maintain the EXACT camera angle, viewing direction, and product orientation. Do not rotate, flip, or reposition the product in any way - only enhance the quality while preserving the identical pose and angle.

`
    : ""
}After this opening, add specific instructions for:

- Accurate centering and alignment of the product (fix perspective, symmetry, balance).
- Removal of all background distractions, fingerprints, dust, scratches.
- Enhancing true color accuracy and brightness for all stones, metals and materials.
- Precise description of the jewelry piece's design and materials (gold type, enamel patterns, stone cuts, textures).
- Emphasizing the luxurious, photorealistic finish suitable for a luxury catalog.
- If there are any engravings, inscriptions, hallmarks, numbers, logos, or any kind of text visible on the jewelry, include a clear instruction to **preserve these markings exactly as in the original, same style and placement** without altering them.

The style must always be technical, descriptive, photorealistic, and tailored to the exact product in the uploaded image. Do not invent new designs; only describe what you see with correct materials and colors.`,
            },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: croppedImage.replace(/^data:image\/\w+;base64,/, ""),
              },
            },
          ],
        },
      ];
      let result = "";
      const response = await ai.models.generateContentStream({
        model,
        contents,
      });
      for await (const chunk of response) {
        result += chunk.text || "";
      }
      return result;
    };

    // Tek process'i işleyen fonksiyon
    const processImage = async (processId: string, prompt: string) => {
      try {
        console.log(
          `📝 Generated prompt for ${processId}:`,
          prompt.substring(0, 200) + "..."
        );

        // Replicate API'ye gönder
        const replicateResult = await sendToReplicate(prompt, croppedImage);

        console.log(
          `🔍 Full Replicate response for ${processId}:`,
          replicateResult
        );

        // Flux Lora'dan gelen sonucu al
        let fluxResultUrl = "";
        if (
          replicateResult.output &&
          typeof replicateResult.output === "string"
        ) {
          fluxResultUrl = replicateResult.output;
        } else if (
          replicateResult.output &&
          Array.isArray(replicateResult.output) &&
          replicateResult.output.length > 0
        ) {
          fluxResultUrl = replicateResult.output[0];
        } else {
          console.log(`❌ No valid Flux output found for ${processId}`);
          setProcesses((prev) =>
            prev.map((p) =>
              p.id === processId
                ? {
                    ...p,
                    status: "error",
                    error: "No valid Flux output received",
                  }
                : p
            )
          );
          return;
        }

        console.log(`🔍 Flux result URL for ${processId}:`, fluxResultUrl);

        // Flux sonucunu increase-resolution'a gönder
        console.log(
          `🚀 Sending Flux result to increase resolution for ${processId}...`
        );
        const increaseResult = await sendToIncreaseResolution(fluxResultUrl);

        console.log(
          `🔍 Increase resolution response for ${processId}:`,
          increaseResult
        );

        // Increase resolution sonucunu al
        let finalResultUrl = "";
        if (
          increaseResult.output &&
          typeof increaseResult.output === "string"
        ) {
          finalResultUrl = increaseResult.output;
        } else if (
          increaseResult.output &&
          Array.isArray(increaseResult.output) &&
          increaseResult.output.length > 0
        ) {
          finalResultUrl = increaseResult.output[0];
        } else {
          console.log(
            `❌ No valid increase resolution output found for ${processId}`
          );
          setProcesses((prev) =>
            prev.map((p) =>
              p.id === processId
                ? {
                    ...p,
                    status: "error",
                    error: "No valid increase resolution output received",
                  }
                : p
            )
          );
          return;
        }

        console.log(`✅ Final result URL for ${processId}:`, finalResultUrl);

        // Final sonucu process'e kaydet
        setProcesses((prev) =>
          prev.map((p) =>
            p.id === processId
              ? {
                  ...p,
                  status: "completed",
                  resultUrl: finalResultUrl,
                }
              : p
          )
        );
      } catch (err: any) {
        console.error(`❌ Error in process ${processId}:`, err);
        setProcesses((prev) =>
          prev.map((p) =>
            p.id === processId
              ? {
                  ...p,
                  status: "error",
                  error: err.message || "Bilinmeyen hata",
                }
              : p
          )
        );
      }
    };

    try {
      // Tek Gemini promptu oluştur
      const prompt = await generatePrompt();

      // 2 paralel Replicate isteği gönder
      await Promise.all([
        processImage(processId1, prompt),
        processImage(processId2, prompt),
      ]);
    } catch (err: any) {
      console.error("❌ Error in prompt generation:", err);
      setError(
        "Prompt oluşturma hatası: " + (err.message || "Bilinmeyen hata")
      );

      // Her iki process'i de hata olarak işaretle
      setProcesses((prev) =>
        prev.map((p) =>
          p.id === processId1 || p.id === processId2
            ? { ...p, status: "error", error: err.message || "Bilinmeyen hata" }
            : p
        )
      );
    }
  };

  const handleConvertToPng = async (imageUrl: string) => {
    // Yeni PNG process oluştur
    const processId = Date.now().toString();
    const newProcess = {
      id: processId,
      originalImageUrl: imageUrl,
      status: "processing" as const,
      timestamp: Date.now(),
    };

    setPngProcesses((prev) => [newProcess, ...prev]);

    try {
      console.log("🖼️ Converting to PNG:", imageUrl);

      const result = await sendToBackgroundRemover(imageUrl);

      console.log("🔍 Background remover response:", result);

      // Process'i güncelle - başarılı
      if (result.output && typeof result.output === "string") {
        console.log("✅ PNG conversion successful:", result.output);
        setPngProcesses((prev) =>
          prev.map((p) =>
            p.id === processId
              ? { ...p, status: "completed", resultUrl: result.output }
              : p
          )
        );
      } else if (
        result.output &&
        Array.isArray(result.output) &&
        result.output.length > 0
      ) {
        console.log("✅ PNG conversion successful (array):", result.output[0]);
        setPngProcesses((prev) =>
          prev.map((p) =>
            p.id === processId
              ? { ...p, status: "completed", resultUrl: result.output[0] }
              : p
          )
        );
      } else {
        console.log("❌ No valid PNG output found");
        setPngProcesses((prev) =>
          prev.map((p) =>
            p.id === processId
              ? { ...p, status: "error", error: "No valid PNG output received" }
              : p
          )
        );
      }
    } catch (err: any) {
      console.error("❌ Error in PNG conversion:", err);
      setPngProcesses((prev) =>
        prev.map((p) =>
          p.id === processId
            ? { ...p, status: "error", error: err.message || "Bilinmeyen hata" }
            : p
        )
      );
    }
  };

  return (
    <div className="main-container">
      {showCrop && image && (
        <div className="crop-modal">
          <div className="crop-content">
            <h3 className="crop-title">Görseli Kırp</h3>
            <Cropper
              image={image}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="rect"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              minZoom={1}
              maxZoom={3}
            />
            <div className="crop-actions">
              <button className="crop-btn" onClick={handleCropSave}>
                Kırpmayı Bitir
              </button>
              <button
                className="crop-cancel-btn"
                onClick={() => setShowCrop(false)}
              >
                İptal
              </button>
            </div>
          </div>
        </div>
      )}

      {showImageModal && selectedImageUrl && (
        <div className="image-modal" onClick={closeImageModal}>
          <div
            className="image-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="image-modal-header">
              <h3>
                {isPngModal
                  ? "PNG Sonuç (Transparent Background)"
                  : "Öncesi / Sonrası Karşılaştırma"}
              </h3>
              <button className="close-btn" onClick={closeImageModal}>
                ✕
              </button>
            </div>

            {isPngModal ? (
              <div className="png-modal-container">
                <img
                  src={selectedImageUrl}
                  alt="PNG Result"
                  className="modal-image transparent-bg"
                />
              </div>
            ) : (
              selectedOriginalImage && (
                <div className="compare-container">
                  <ReactCompareImage
                    leftImage={selectedOriginalImage}
                    rightImage={selectedImageUrl}
                    leftImageLabel="Orijinal"
                    rightImageLabel="İyileştirilmiş"
                    leftImageCss={{ objectFit: "contain" }}
                    rightImageCss={{ objectFit: "contain" }}
                  />
                </div>
              )
            )}
            <div className="image-modal-actions">
              <button
                className="download-btn"
                onClick={() => handleDownload(selectedImageUrl)}
              >
                İndir
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card upload-section">
        <h2>Resim Yükle</h2>
        <div className="upload-area">
          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            ref={fileInputRef}
            onChange={handleImageChange}
          />
          <button
            className="upload-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            Resim Seç
          </button>
          {croppedImage && (
            <img src={croppedImage} alt="Yüklenen" className="preview-image" />
          )}
        </div>

        <div className="preserve-pose-section">
          <label className="preserve-pose-label">
            <input
              type="checkbox"
              checked={preservePose}
              onChange={(e) => setPreservePose(e.target.checked)}
              className="preserve-pose-checkbox"
            />
            <div className="preserve-pose-custom-checkbox"></div>
            <div className="preserve-pose-content">
              <span className="preserve-pose-text">Pozu Koru</span>
              <span className="preserve-pose-description">
                Ürünün kamera açısı ve pozisyonunu korur
              </span>
            </div>
          </label>
        </div>

        <button
          className="create-btn"
          onClick={handleCreate}
          disabled={!croppedImage}
        >
          Oluştur
        </button>
      </div>

      <div className="card result-section">
        <h2>Sonuç Kartı</h2>
        <div className="result-card">
          {error ? (
            <span style={{ color: "#ef4444" }}>{error}</span>
          ) : processes.length > 0 ? (
            <div className="process-list">
              {processes.map((process) => (
                <div
                  key={process.id}
                  className={`process-item ${process.status}`}
                >
                  <div className="process-header">
                    <div className="process-info">
                      <img
                        src={process.originalImage}
                        alt="Original"
                        className="process-thumbnail"
                      />
                      <div className="process-title">
                        <h4>
                          İşlem #{processes.length - processes.indexOf(process)}
                        </h4>
                        <span>
                          {new Date(process.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                    <div className="process-status-badge">
                      {process.status === "processing" && (
                        <span className="status-badge processing">
                          İşleniyor
                        </span>
                      )}
                      {process.status === "completed" && (
                        <>
                          <span className="status-badge completed">
                            Tamamlandı
                          </span>
                          {process.resultUrl && (
                            <>
                              <button
                                className="png-btn-small"
                                onClick={() =>
                                  handleConvertToPng(process.resultUrl!)
                                }
                                title="PNG'ye Dönüştür"
                              >
                                PNG Yap
                              </button>
                              <button
                                className="download-btn-small"
                                onClick={() =>
                                  handleDownload(process.resultUrl!)
                                }
                                title="Sonucu İndir"
                              >
                                İndir
                              </button>
                            </>
                          )}
                        </>
                      )}
                      {process.status === "error" && (
                        <span className="status-badge error">Hata</span>
                      )}
                    </div>
                  </div>
                  <div className="process-status">
                    {process.status === "processing" && (
                      <div className="status-content">
                        <div className="spinner"></div>
                        <span>AI ile iyileştiriliyor...</span>
                      </div>
                    )}
                    {process.status === "completed" && process.resultUrl && (
                      <div className="status-content">
                        <img
                          src={process.resultUrl}
                          alt="Completed"
                          className="result-image"
                          onClick={() =>
                            process.resultUrl &&
                            handleImageClick(
                              process.resultUrl,
                              process.originalImage
                            )
                          }
                          title="Büyütmek için tıklayın"
                        />
                      </div>
                    )}
                    {process.status === "error" && (
                      <div className="status-content">
                        <span className="error-message">
                          {process.error || "Bilinmeyen hata"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : croppedImage ? (
            <span>Resim hazır! "Oluştur" butonuna tıklayın.</span>
          ) : (
            <span>Lütfen bir resim yükleyin</span>
          )}
        </div>
      </div>

      <div className="card png-section">
        <h2>PNG Dönüştürme</h2>
        <div className="png-card">
          {pngProcesses.length > 0 ? (
            <div className="process-list">
              {pngProcesses.map((process) => (
                <div
                  key={process.id}
                  className={`process-item ${process.status}`}
                >
                  <div className="process-header">
                    <div className="process-info">
                      <img
                        src={process.originalImageUrl}
                        alt="Original"
                        className="process-thumbnail"
                      />
                      <div className="process-title">
                        <h4>
                          PNG #
                          {pngProcesses.length - pngProcesses.indexOf(process)}
                        </h4>
                        <span>
                          {new Date(process.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                    <div className="process-status-badge">
                      {process.status === "processing" && (
                        <span className="status-badge processing">
                          İşleniyor
                        </span>
                      )}
                      {process.status === "completed" && (
                        <>
                          <span className="status-badge completed">
                            Tamamlandı
                          </span>
                          {process.resultUrl && (
                            <button
                              className="download-btn-small"
                              onClick={() => handleDownload(process.resultUrl!)}
                              title="PNG İndir"
                            >
                              İndir
                            </button>
                          )}
                        </>
                      )}
                      {process.status === "error" && (
                        <span className="status-badge error">Hata</span>
                      )}
                    </div>
                  </div>
                  <div className="process-status">
                    {process.status === "processing" && (
                      <div className="status-content">
                        <div className="spinner"></div>
                        <span>PNG'ye dönüştürülüyor...</span>
                      </div>
                    )}
                    {process.status === "completed" && process.resultUrl && (
                      <div className="status-content">
                        <img
                          src={process.resultUrl}
                          alt="PNG Result"
                          className="result-image png-result-image"
                          onClick={() =>
                            process.resultUrl &&
                            handlePngImageClick(process.resultUrl)
                          }
                          title="Büyütmek için tıklayın"
                        />
                      </div>
                    )}
                    {process.status === "error" && (
                      <div className="status-content">
                        <span className="error-message">
                          {process.error || "Bilinmeyen hata"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <span>PNG dönüştürme için "PNG Yap" butonuna tıklayın</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
