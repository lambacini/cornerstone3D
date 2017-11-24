class DICOMZero {
  constructor(options={}) {
    this.status = options.status || function() {};
    this.reset();
  }

  reset() {
    this.mappingLog = [];
    this.dataTransfer = undefined;
    this.unnaturalDatasets = [];
    this.datasets = [];
    this.readers = [];
    this.arrayBuffers = [];
    this.files = [];
    this.fileIndex = 0;
    this.context = {patients: []};
  }

  getReadDICOMFunction(doneCallback, statusCallback) {
    statusCallback = statusCallback || console.log;
    return progressEvent => {
      let reader = progressEvent.target;
      let arrayBuffer = reader.result;
      this.arrayBuffers.push(arrayBuffer);

      let dicomData;
      try {
        dicomData = DCMJS.data.DicomMessage.readFile(arrayBuffer);
        this.unnaturalDatasets.push(dicomData.dict);
        let dataset = DCMJS.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict);
        dataset._meta = DCMJS.data.DicomMetaDictionary.namifyDataset(dicomData.meta);
        this.datasets.push(dataset);
      } catch (error) {
        console.error(error);
        statusCallback("skipping non-dicom file");
      }

      let readerIndex = this.readers.indexOf(reader);
      if (readerIndex < 0) {
        reject("Logic error: Unexpected reader!");
      } else {
        this.readers.splice(readerIndex, 1); // remove the reader
      }

      if (this.fileIndex === this.dataTransfer.files.length) {
        statusCallback(`Normalizing...`);
        try {
          this.multiframe = DCMJS.normalizers.Normalizer.normalizeToDataset(this.datasets);
        } catch (e) {
          console.error('Could not convert to multiframe');
          console.error(e);
        }
        statusCallback(`Creating segmentation...`);
        try {
          this.seg = new DCMJS.derivations.Segmentation([this.multiframe]);
          statusCallback(`Created ${this.multiframe.NumberOfFrames} frame multiframe object and segmentation.`);
        } catch (e) {
          console.error('Could not create segmentation');
          console.error(e);
        }
        doneCallback();
      } else {
        statusCallback(`Reading... (${this.fileIndex+1}).`);
        this.readOneFile(doneCallback, statusCallback);
      }
    };
  }

  // Used for file selection button or drop of file list
  readOneFile(doneCallback, statusCallback) {
    let file = this.dataTransfer.files[this.fileIndex];
    this.fileIndex++;

    let reader = new FileReader();
    reader.onload = this.getReadDICOMFunction(doneCallback, statusCallback);
    reader.readAsArrayBuffer(file);

    this.files.push(file);
    this.readers.push(reader);
  }

  handleDataTransferFileAsDataset(file, options={}) {
    options.doneCallback = options.doneCallback || function(){};

    let reader = new FileReader();
    reader.onload = (progressEvent) => {
      let dataset = this.datasetFromArrayBuffer(reader.result);
      options.doneCallback(dataset);
    }
    reader.readAsArrayBuffer(file);
  }

  datasetFromArrayBuffer(arrayBuffer) {
    let dicomData = DCMJS.data.DicomMessage.readFile(arrayBuffer);
    this.unnaturalDatasets.push(dicomData.dict);
    let dataset = DCMJS.data.DicomMetaDictionary.naturalizeDataset(dicomData.dict);
    dataset._meta = DCMJS.data.DicomMetaDictionary.namifyDataset(dicomData.meta);
    return(dataset);
  }

  extractDatasetFromZipArrayBuffer(arrayBuffer) {
    this.status(`Extracting ${this.datasets.length} of ${this.expectedDICOMFileCount}...`);
    this.datasets.push(this.datasetFromArrayBuffer(arrayBuffer));
    if (this.datasets.length == this.expectedDICOMFileCount) {
      this.status(`Finished extracting`);
      this.zipFinishCallback();
    }
  };

  handleZip(zip) {
    this.zip = zip;
    this.expectedDICOMFileCount = 0;
    Object.keys(zip.files).forEach(fileKey => {
      this.status(`Considering ${fileKey}...`);
      if (fileKey.endsWith('.dcm')) {
        this.expectedDICOMFileCount += 1;
        zip.files[fileKey].async('arraybuffer').then(this.extractDatasetFromZipArrayBuffer.bind(this));
      }
    });
  }

  extractFromZipArrayBuffer(arrayBuffer, finishCallback=function(){}) {
    this.zipFinishCallback = finishCallback;
    this.status("Extracting from zip...");
    JSZip.loadAsync(arrayBuffer)
    .then(this.handleZip.bind(this));
  }

  organizeDatasets() {
    this.datasets.forEach(dataset => {
      let patientName = dataset.PatientName;
      let studyTag = dataset.StudyDate + ": " + dataset.StudyDescription;
      let seriesTag = dataset.SeriesNumber + ": " + dataset.SeriesDescription;
      let patientNames = this.context.patients.map(patient => patient.name);
      let patientIndex = patientNames.indexOf(dataset.PatientName);
      if (patientIndex == -1) {
        this.context.patients.push({
          name: dataset.PatientName,
          id: this.context.patients.length,
          studies: {}
        });
      }
      let studyNames; // TODO - finish organizing
    });
  }
}
