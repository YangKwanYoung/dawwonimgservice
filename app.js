const express = require("express");
const admin = require("firebase-admin");
const multer = require("multer");
const ExifParser = require("exif-parser");
const ExifImage = require("exif").ExifImage;

const app = express();
const PORT = process.env.PORT || 3000;

const path = require("path");
const fs = require("fs");
const archiver = require("archiver");
// Firebase Admin SDK 초기화
const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "itfimgsaveservice.appspot.com", // storageBucket을 사용하여 버킷 설정
  databaseURL: "https://itfimgsaveservice.firebaseio.com",
});

// Firebase Storage 초기화
const storage = admin.storage();
const bucket = admin.storage().bucket();
// Firebase Firestore 초기화
const firestore = admin.firestore();

// 업로드할 파일을 저장할 디렉토리 설정
const upload = multer({
  storage: multer.memoryStorage(), // 파일을 메모리에 저장하여 사용할 수 있도록 설정
  limits: {
    fileSize: 20 * 1024 * 1024, // 파일 크기 제한 설정 (5MB)
    files: 10, // 최대 파일 개수 설정
  },
});

// EJS 템플릿 엔진 설정
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// 정적 파일을 제공하기 위한 미들웨어 추가
app.use(express.static(path.join(__dirname, "public")));

// 루트 경로
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname + "/index.html"));
});

//  로고경로
app.get("/picture", (req, res) => {
  fs.readFile("./lgogo.pblhhg", function (err, data) {
    console.log("picture loading...");
    res.writeHead(200);
    res.write(data);
    res.end();
  });
});

// 업로드 지도 보기 페이지 라우트
app.get("/map", async (req, res) => {
  try {
    const snapshot = await firestore.collection("photoinfo").get();
    const photoData = [];
    snapshot.forEach((doc) => {
      photoData.push(doc.data());
    });
    res.render("map", { photos: photoData }); // map.html 파일에 데이터를 전달하여 렌더링
  } catch (error) {
    console.error("Error fetching documents:", error);
    res.status(500).send("데이터 가져오기에 실패했습니다.");
  }
});
// "/constructionTypes" 엔드포인트 처리
app.get("/constructionTypes", async (req, res) => {
  try {
    // Firestore에서 공종 데이터를 가져옴
    const snapshot = await firestore.collection("photoinfo").get();
    const constructionTypes = new Set();

    // 가져온 데이터에서 공종 정보를 추출
    snapshot.forEach((doc) => {
      constructionTypes.add(doc.data().constructionType);
    });

    // Set을 배열로 변환하여 클라이언트에게 전달
    res.json(Array.from(constructionTypes));
  } catch (error) {
    console.error("Error fetching construction types:", error);
    res
      .status(500)
      .json({ error: "An error occurred while fetching construction types." });
  }
});
// "/search" 엔드포인트 처리
app.get("/search1", async (req, res) => {
  try {
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    let query = firestore.collection("photoinfo");

    if (startDate && endDate) {
      query = query.where("date", ">=", startDate).where("date", "<=", endDate);
    }

    const snapshot = await query.get();
    const result = {};

    snapshot.forEach((doc) => {
      const data = doc.data();
      const constructionSite = data.constructionSite;
      const constructionType = data.constructionType;

      // 현장별로 데이터를 그룹화하고, 각 그룹에 공종별로 카운트
      if (!result[constructionSite]) {
        result[constructionSite] = {};
      }

      if (!result[constructionSite][constructionType]) {
        result[constructionSite][constructionType] = 0;
      }

      result[constructionSite][constructionType]++;
    });

    res.json(result);
  } catch (error) {
    console.error("문서 검색 중 오류 발생:", error);
    res.status(500).json({ error: "문서 검색 중 오류가 발생했습니다." });
  }
});

// "/search" 엔드포인트 처리
app.get("/search", async (req, res) => {
  try {
    const constructionSite = req.query.constructionSite;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const constructionType = req.query.constructionType;

    let query = firestore.collection("photoinfo");

    // 조건에 따라 쿼리 조정
    if (constructionSite !== "전체") {
      query = query.where("constructionSite", "==", constructionSite);
    }
    if (startDate) {
      query = query.where("date", ">=", startDate);
    }
    if (endDate) {
      query = query.where("date", "<=", endDate);
    }
    if (constructionType !== "전체") {
      query = query.where("constructionType", "==", constructionType);
    }

    const snapshot = await query.get();
    const result = [];
    snapshot.forEach((doc) => {
      // 각 문서의 ID를 데이터에 추가하여 결과에 포함
      const data = doc.data();
      data.id = doc.id;
      result.push(data);
    });
    res.json(result);
  } catch (error) {
    console.error("문서 검색 중 오류 발생:", error);
    res.status(500).json({ error: "문서 검색 중 오류가 발생했습니다." });
  }
});

// "/aggregate" 엔드포인트 처리
app.get("/aggregate", async (req, res) => {
  try {
    let query = firestore.collection("photoinfo");

    // 검색 조건이 있을 경우에만 조건을 추가
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    if (startDate && endDate) {
      query = query.where("date", ">=", startDate).where("date", "<=", endDate);
    }
    // 날짜를 내림차순으로 정렬
    query = query.orderBy("date", "desc");
    const snapshot = await query.get();
    const aggregateData = {}; // 현장 및 공종별 이미지 수를 집계할 객체

    snapshot.forEach((doc) => {
      const data = doc.data();
      const date = data.date;
      const site = data.constructionSite;
      const type = data.constructionType;

      // 데이터를 일자별, 현장별, 공종별로 그룹화하여 이미지 수를 집계
      if (!aggregateData[date]) {
        aggregateData[date] = {};
      }
      if (!aggregateData[date][site]) {
        aggregateData[date][site] = {};
      }
      if (!aggregateData[date][site][type]) {
        aggregateData[date][site][type] = 0;
      }
      aggregateData[date][site][type]++;
    });

    res.render("aggregate", { aggregateData: aggregateData });
  } catch (error) {
    console.error("Error fetching aggregate data:", error);
    res.status(500).send("집계 데이터 가져오기에 실패했습니다.");
  }
});

// '/download' 엔드포인트 처리
app.get("/download", async (req, res) => {
  try {
    const constructionSite = req.query.constructionSite;
    const constructionType = req.query.constructionType;

    const date = req.query.date;
    const { default: got } = await import("got"); // got 모듈을 올바르게 불러옴
    // Firestore에서 이미지 다운로드 URL 가져오기
    const querySnapshot = await firestore
      .collection("photoinfo")
      .where("constructionSite", "==", constructionSite)
      .where("constructionType", "==", constructionType)

      .where("date", "==", date)
      .get();

    // 데이터가 없을 때 경고창 띄우기
    if (querySnapshot.empty) {
      return res.status(404).json({ message: "No data found." });
    }

    const downloadUrls = [];
    querySnapshot.forEach((doc) => {
      console.log(doc.data());
      imageUrl = doc.data().imageUrl;
      downloadUrls.push({
        imageUrl: imageUrl,
        fileName: `${date}_${constructionSite}_${constructionType}_${Date.now()}.jpg`, // 파일명에 현재 시간 추가하여 중복 방지
      });
    });

    // 이미지 다운로드 및 압축
    const zipPath = `${date}_${constructionSite}_${constructionType}.zip`;
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    for (const imageInfo of downloadUrls) {
      const imageFileName = imageInfo.fileName;
      const imageUrl =
        "https://storage.googleapis.com/itfimgsaveservice.appspot.com" +
        imageInfo.imageUrl;
      console.log(imageUrl);
      // Firebase Storage에서 이미지 다운로드
      const response = await got(imageUrl, {
        responseType: "buffer",
      });
      archive.append(response.body, { name: imageFileName }); // 이미지 파일 추가
    }
    output.on("close", () => {
      console.log(archive.pointer() + " total bytes");
      console.log(
        "archiver has been finalized and the output file descriptor has closed."
      );
      res.download(zipPath); // 압축 파일 다운로드
    });
    archive.pipe(output);

    archive.finalize(); // 압축 종료
  } catch (error) {
    console.error("Error downloading images:", error);
    res
      .status(500)
      .json({ error: "An error occurred while downloading images." });
  }
});
// 파일 업로드 엔드포인트
app.post("/upload", upload.array("images", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).send("이미지를 선택하세요.");
    }

    // 업로드된 각 파일에 대한 처리
    for (const file of req.files) {
      // 업로드된 파일이 JPEG 형식인지 확인
      if (file.mimetype !== "image/jpeg") {
        return res
          .status(400)
          .send("올바른 JPEG 형식의 이미지를 업로드하세요.");
      }

      // 파일 크기 제한 확인
      if (file.size > 20 * 1024 * 1024) {
        // 5MB 이하의 파일만 허용
        return res.status(400).send("이미지 파일 크기는 20MB 이하여야 합니다.");
      }
    }

    const constructionSite = req.body.constructionSite;
    const constructionType = req.body.constructionType;
    const date = req.body.date;

    // 각 이미지 파일에 대해 처리
    for (const file of req.files) {
      // 이미지 파일 업로드
      const fileName = Date.now() + "_" + encodeURIComponent(file.originalname);
      const metadata = {
        contentType: file.mimetype,
      };

      // 파일을 로컬 디스크에 저장
      const localFilePath = `${__dirname}/${fileName}`;
      fs.writeFileSync(localFilePath, file.buffer);

      // 이미지 파일 업로드
      await bucket.upload(localFilePath, {
        destination: fileName,
        metadata: metadata,
      });

      // 이미지 파일 업로드 후 로컬 파일 삭제
      fs.unlinkSync(localFilePath);

      // 이미지 파일의 다운로드 URL 가져오기
      const imageUrl = `/${fileName}`;

      // EXIF 데이터에서 좌표값 추출
      let latitude = null;
      let longitude = null;
      const exifParser = ExifParser.create(file.buffer);
      const exifResult = exifParser.parse();
      if (
        exifResult.tags &&
        exifResult.tags.GPSLatitude &&
        exifResult.tags.GPSLongitude
      ) {
        console.log(
          "exifResult.tags.GPSLatitude" + exifResult.tags.GPSLatitude
        );
        console.log(
          "exifResult.tags.GPSLongitude" + exifResult.tags.GPSLongitude
        );
        latitude = exifResult.tags.GPSLatitude;
        longitude = exifResult.tags.GPSLongitude;

        //  latitude = gpsLatitude[0] + gpsLatitude[1] / 60 + gpsLatitude[2] / 3600;
        //  longitude = gpsLongitude[0] + gpsLongitude[1] / 60 + gpsLongitude[2] / 3600;
      }

      // Firestore에 이미지 정보 및 좌표값 저장
      await firestore.collection("photoinfo").add({
        constructionSite: constructionSite,
        constructionType: constructionType,
        date: date,
        imageUrl: imageUrl,
        latitude: latitude,
        longitude: longitude,
      });
    }

    res.status(200).redirect("/");
  } catch (error) {
    console.error("Error uploading image:", error);
    res.status(500).send("이미지 업로드에 실패했습니다.");
  }
});
// "/deleteImage" 엔드포인트 처리
app.delete("/deleteImage", async (req, res) => {
  try {
    const docId = req.query.id; // 이미지의 Firestore 문서 ID
    // Firestore에서 해당 이미지 문서 가져오기
    const imageDoc = await firestore.collection("photoinfo").doc(docId).get();
    if (!imageDoc.exists) {
      return res.status(404).json({ message: "이미지를 찾을 수 없습니다." });
    }
    console.log(`imageDoc ${imageDoc.data().imageUrl}`); // 이미지 URL 출력
    const imageUrl = imageDoc.data().imageUrl; // 삭제할 이미지의 URL
    // 이미지 URL에서 파일명 추출
    const fileName = imageUrl.split("/").pop();
    // Firebase Storage에서 이미지 삭제
    await bucket.file(fileName).delete();
    // Firestore에서 이미지 문서 삭제
    await firestore.collection("photoinfo").doc(docId).delete();
    res.status(200).json({ message: "이미지가 성공적으로 삭제되었습니다." });
  } catch (error) {
    console.error("이미지 삭제 중 오류 발생:", error);
    res.status(500).json({ error: "이미지 삭제 중 오류가 발생했습니다." });
  }
});

// 파일 업로드 엔드포인트
app.post("/upload1", upload.array("images", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).send("이미지를 선택하세요.");
    }

    // 업로드된 각 파일에 대한 처리
    for (const file of req.files) {
      // 업로드된 파일이 JPEG 형식인지 확인
      if (file.mimetype !== "image/jpeg") {
        return res
          .status(400)
          .send("올바른 JPEG 형식의 이미지를 업로드하세요.");
      }

      // 파일 크기 제한 확인
      if (file.size > 20 * 1024 * 1024) {
        // 5MB 이하의 파일만 허용
        return res.status(400).send("이미지 파일 크기는 20MB 이하여야 합니다.");
      }
    }

    const constructionSite = req.body.constructionSite;
    const constructionType = req.body.constructionType;

    const date = req.body.date;

    // 각 이미지 파일에 대해 처리
    for (const file of req.files) {
      // 이미지 파일 업로드
      const fileName = Date.now() + "_" + encodeURIComponent(file.originalname);
      const metadata = {
        contentType: file.mimetype,
      };

      // 파일을 로컬 디스크에 저장
      const localFilePath = `${__dirname}/${fileName}`;
      fs.writeFileSync(localFilePath, file.buffer);

      // 이미지 파일 업로드
      await bucket.upload(localFilePath, {
        destination: fileName,
        metadata: metadata,
      });

      // 이미지 파일 업로드 후 로컬 파일 삭제
      fs.unlinkSync(localFilePath);
      // 이미지 파일의 다운로드 URL 가져오기
      const imageUrl = `/${fileName}`;

      // EXIF 데이터에서 좌표값 추출
      const exifParser = ExifParser.create(file.buffer);
      const exifResult = exifParser.parse();
      const { latitude, longitude } =
        exifResult.tags.GPSLatitude && exifResult.tags.GPSLongitude
          ? {
              latitude: exifResult.tags.GPSLatitude,
              longitude: exifResult.tags.GPSLongitude,
            }
          : { latitude: null, longitude: null };

      // Firestore에 이미지 정보 및 좌표값 저장
      await firestore.collection("photoinfo").add({
        constructionSite: constructionSite,
        constructionType: constructionType,
        date: date,
        imageUrl: imageUrl,
        latitude: latitude,
        longitude: longitude,
      });
    }

    res.status(200).redirect("/");
  } catch (error) {
    console.error("Error uploading image:", error);
    res.status(500).send("이미지 업로드에 실패했습니다.");
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
