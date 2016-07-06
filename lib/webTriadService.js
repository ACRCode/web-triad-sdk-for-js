var inputFiles = $("#files");
var listFile = $("#listFiles");

var selectBtn = $("#selectFiles");
var uploadAllBtn = $("#uploadAll");
var removeAllBtn = $("#removeAll");

var ServeApiUrl = "";
var FileApiUrl = "/files";
var SubmissionFileInfoApiUrl = "/submissionPackages";
var SubmittedStudiesDetailsUrl = "/studies";
var SubmittedFilesDetailsUrl = "/submittedPackageFiles";
var DicomViewerUrl = "/dicomViewerUrl";

$.when(
    getServeApiUrl()).then(function (url) {
        ServeApiUrl = url;
        FileApiUrl = ServeApiUrl + FileApiUrl;
        SubmissionFileInfoApiUrl = ServeApiUrl + SubmissionFileInfoApiUrl;
        SubmittedStudiesDetailsUrl = ServeApiUrl + SubmittedStudiesDetailsUrl;
        SubmittedFilesDetailsUrl = ServeApiUrl + SubmittedFilesDetailsUrl;
        DicomViewerUrl = ServeApiUrl + DicomViewerUrl;
    });

function getServeApiUrl() {
    return $.ajax({
        url: "GetServerApiUrl",
        type: "GET",
        dataType: 'json',

        error: function (jqXhr, textStatus, errorThrown) {
            console.log(textStatus + " // " + errorThrown + " // " + jqXhr.responseText);
        },
        success: function (data, textStatus, jqXhr) {
            console.log(jqXhr.responseText);
        }
    });
}

var SizeChunk = 10485760;

var fileList = [];

var countFiles = 0;
var countUploadedFiles = 0;
var fileUris = [];

selectBtn.click(function () {
    inputFiles.trigger("click");
});

inputFiles.change(function (e) {
    fileList = [];
    var files = e.target.files;
    countFiles = files.length;
    countUploadedFiles = 0;
    fileUris = [];
    listFile.html("");
    var tableHtml = $('<table class="table table-striped"><thead><tr><th class="col-md-4">Name</th><th class="col-md-4">Progress</th><th class="col-md-2"></th><th class="col-md-1">Status</th></tr></thead><tbody></tbody></table>');
    if (files.length > 0) {
        listFile.append($(tableHtml));
        removeAllBtn.show();
        uploadAllBtn.show();
    } else {
        removeAllBtn.hide();
        uploadAllBtn.hide();
    }

    var progressBars =
              '<div class="progress progress active" style="display: none;   margin-bottom: 0">' +
                  '<div class="progress-bar"  role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style=" width: 0%">' +
                  '</div>' +
              '</div>';

    var cancelUploadBtn =
        '<button id="cancelUpload" style="display: none;" type="button" class="btn btn-danger" onclick="cancelUpload($(this).closest(' + '\'tr\'' + ').attr(' + '\'data-file-name\'' + '))">cancel</button>';
    var uploadFileBtn =
        '<button id="uploadFile" type="button" style=" display: none; margin-right: 15px" class="btn btn-warning" onclick="uploadFileByName($(this).closest(' + '\'tr\'' + ').attr(' + '\'data-file-name\'' + '))">upload</button>';

    tableHtml = listFile.find("tbody");

    if (files.length > 0) {
        for (var i = 0; i < files.length; i++) {
            files[i].number = i;
            fileList.push(files[i]);
            $(tableHtml).append("<tr id='file" + fileList[i].number + "' data-file-name='" + fileList[i].name + "_" + fileList[i].number + "'>" +
                "<td id='fileName" + fileList[i].number + "'>" + fileList[i].name + "</td>" +
                "<td id='fileProgress" + fileList[i].number + "'>" + progressBars + "</td>" +
                "<td id='fileManage" + fileList[i].number + "'>" + uploadFileBtn + cancelUploadBtn + "</td>" +
                "<td id='fileStatus" + fileList[i].number + "'></td>" +
                "</tr>");

            setFileStatus(fileList[i], "ready");
        }
    }
});

removeAllBtn.click(function () {
    fileList = null;
    listFile.html("");
    uploadAllBtn.hide();
    removeAllBtn.hide();
});


uploadAllBtn.click(function () {
    removeAllBtn.hide();
    uploadAllFiles();
});

function cancelUpload(name) {
    var file = getFileByName(name);
    cancelUploadFile(file);
}

function uploadAllFiles() {
    for (var i = 0; i < fileList.length; i++) {
        if (fileList[i].status === "ready" || fileList[i].status === "canceled")
            uploadFile(fileList[i]);
    }
}

function uploadFileByName(name) {
    removeAllBtn.hide();
    uploadFile(getFileByName(name));
}

function uploadFile(file) {

    setFileStatus(fileList[file.number], "uploading");
    var numberOfChunks = Math.ceil(file.size / SizeChunk);
    var start = 0;
    var end = SizeChunk;
    var numberOfSuccessfulUploadChunks = 0;
    var sim = 6;
    var guid;

    $.when(
        createFileResource()).then(function () {

            fileList[file.number].guid = guid;
            fileUris.push(guid);
            start = SizeChunk;
            end = start + SizeChunk;
            for (var i = 2; i <= sim; i++) {
                if (start >= file.size) return;
                sendChunk(start, end, i);
                start = i * SizeChunk;
                end = start + SizeChunk;
            }
        });

    function uploadHandler(jqXhr, chunkNumber) {
        if (jqXhr.readyState === XMLHttpRequest.DONE && (jqXhr.status === 200 || jqXhr.status === 201)) {
            console.log("uploaded chunk - " + chunkNumber + " / " + file.name + " / " + guid);
            numberOfSuccessfulUploadChunks++;
            var value = Math.ceil(numberOfSuccessfulUploadChunks / numberOfChunks * 100);
            updateProgress(file, value);

            if (numberOfSuccessfulUploadChunks === numberOfChunks) {
                setFileStatus(fileList[file.number], "uploaded");
                updateProgress(file, 100);
                countUploadedFiles++;
                submitToServer();
            }
            chunkNumber += sim;

            if (chunkNumber > numberOfChunks) return;

            start = (chunkNumber - 1) * SizeChunk;
            end = start + SizeChunk;

            sendChunk(start, end, chunkNumber);

        } else if (jqXhr.readyState === XMLHttpRequest.DONE) {
            if (file.status !== "canceling" && file.status !== "cancelError" && file.status !== "canceled") setFileStatus(file, "uploadError");
            console.log(jqXhr.responseText + " / " + chunkNumber + " / " + file.name);
        }
    }

    function sendChunk(start, end, chunkNumber) {
        if (fileList[file.number].status === "canceled" || fileList[file.number].status === "canceling" || fileList[file.number].status === "cancelError") return;
        var chunk = file.slice(start, end);
        var formData = new FormData();
        formData.append("chunkOffset", start);
        formData.append("chunk", chunk, file.name);
        $.ajax({
            url: FileApiUrl + "/" + guid,
            data: formData,
            contentType: false,
            processData: false,
            type: "POST",
            complete: function (jqXhr) {
                uploadHandler(jqXhr, chunkNumber);
            }
        });
    }

    function createFileResource() {
        var chunk = file.slice(0, SizeChunk);
        var formData = new FormData();
        formData.append("chunk", chunk, file.name);

        return $.ajax({
            url: FileApiUrl,
            type: "PUT",
            contentType: false,
            processData: false,
            data: formData,
            error: function (jqXhr, textStatus, errorThrown) {
                console.log(textStatus + " // " + errorThrown + " // " + jqXhr.responseText);
            },
            success: function (data, textStatus, jqXhr) {
                guid = jqXhr.getResponseHeader("Location");
                console.log(jqXhr.responseText);
            },
            complete: function (jqXhr) {
                uploadHandler(jqXhr, 1);
            }
        });
    }

    function submitToServerToSP() {

        if (countFiles !== countUploadedFiles) {
            return;
        }

        var data = fillForm();

        var parameters = {
            FileUris: fileUris,
            Metadata: data
        };

        $.ajax({
            url: SubmissionFileInfoApiUrl + "/" + "08a7976a-c6c0-4067-9955-d29ad5a283fd",
            type: "Post",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(fileUris),
            error: function (jqXhr, textStatus, errorThrown) {
                console.log(textStatus + " // " + errorThrown + " // " + jqXhr.responseText);
                for (var i = 0; i < fileList.length; i++) {
                    setFileStatus(fileList[i], "submitError");
                }

            },
            success: function (data, textStatus, jqXhr) {
                console.log(jqXhr.responseText);
                for (var i = 0; i < fileList.length; i++) {
                    setFileStatus(fileList[file.number], "submitted");
                }
            }
        });
    }

    function submitToServer() {
        var typeRequest = "PUT";
        if (window.location.pathname.indexOf("/Attaching") !== -1) {
            typeRequest = "POST";
        }

        if (countFiles !== countUploadedFiles) {
            return;
        }

        var data = fillForm();

        data.push(
               {
                   Name: "TransactionUID",
                   Value: getGuid()
               });

        var parameters = {
            FileUris: fileUris,
            Metadata: data
        };

        $.ajax({
            url: SubmissionFileInfoApiUrl,
            type: typeRequest,
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(parameters),
            error: function (jqXhr, textStatus, errorThrown) {
                console.log(textStatus + " // " + errorThrown + " // " + jqXhr.responseText);
                for (var i = 0; i < fileList.length; i++) {
                    setFileStatus(fileList[i], "submitError");
                }
            },
            success: function (data, textStatus, jqXhr) {
                console.log(jqXhr.responseText);
                for (var i = 0; i < fileList.length; i++) {
                    setFileStatus(fileList[i], "submitted");
                }
            }
        });
    }

}

function cancelUploadFile(file) {

    setFileStatus(file, "canceling");

    $.ajax({
        url: FileApiUrl + "/" + file.guid,
        type: "DELETE",
        complete: function (jqXhr) {
            cancelHandler(jqXhr);
        }
    });


    function cancelHandler(jqXhr) {
        if (jqXhr.readyState === XMLHttpRequest.DONE && jqXhr.status === 200) {
            setFileStatus(file, "canceled");
            console.log(jqXhr.responseText + " / " + file.name);

        } else if (jqXhr.readyState === XMLHttpRequest.DONE) {
            setFileStatus(file, "cancelError");
            console.log(jqXhr.responseText + " / " + file.name);
        }
    }
}

function getFileByName(name) {
    for (var i = 0; i < fileList.length; i++) {
        if (fileList[i].name + "_" + fileList[i].number === name) return fileList[i];
    }
    return null;
}


function setFileStatus(file, status) {

    fileList[file.number].status = status;

    switch (status) {
        case "ready":
            updateProgress(file, 0);
            showUploadFileButton(file);
            break;
        case "uploading":
            status = "uploading...";
            showProgress(file);
            showCancelButton(file);
            disabledUploadFileButton(file);
            break;
        case "uploaded":
            hideProgress(file);
            hideUploadFilelButton(file);
            disabledCancelButton(file);
            break;
        case "uploadError":
            break;
        case "canceling":
            status = "canceling...";
            disabledCancelButton(file);
            hideProgress(file);
            break;
        case "canceled":
            hideCancelButton(file);
            updateProgress(file, 0);
            showUploadFileButton(file);
            break;
        case "cancelError":
            break;
        default:
            break;
    }
    setFileStatusUi(file, status);
}

function setFileStatusUi(file, status) {
    $("tr[data-file-name*='" + file.name + "_" + file.number + "'] td[id*=fileStatus]").html(status);
}
function showCancelButton(file) {
    unDisabledCancelButton(file);
    $("tr[data-file-name*='" + file.name + "_" + file.number + "'] button#cancelUpload").show();
}
function disabledCancelButton(file) {
    $("tr[data-file-name*='" + file.name + "_" + file.number + "'] button#cancelUpload").addClass("disabled").attr("disabled", "disabled");
}
function unDisabledCancelButton(file) {
    $("tr[data-file-name*='" + file.name + "_" + file.number + "'] button#cancelUpload").removeClass("disabled").removeAttr("disabled");
}
function hideCancelButton(file) {
    $("tr[data-file-name*='" + file.name + "_" + file.number + "'] button#cancelUpload").hide();
}
function showUploadFileButton(file) {
    unDisabledUploadFileButton(file);
    $("tr[data-file-name*='" + file.name + "_" + file.number + "'] button#uploadFile").show();
}
function disabledUploadFileButton(file) {
    $("tr[data-file-name*='" + file.name + "_" + file.number + "'] button#uploadFile").addClass("disabled").attr("disabled", "disabled");
}
function unDisabledUploadFileButton(file) {
    $("tr[data-file-name*='" + file.name + "_" + file.number + "'] button#uploadFile").removeClass("disabled").removeAttr("disabled");
}
function hideUploadFilelButton(file) {
    $("tr[data-file-name*='" + file.name + "_" + file.number + "'] button#uploadFile").hide();
}
function showProgress(file) {
    $("tr[data-file-name*='" + file.name + "_" + file.number + "'] div.progress").show();
}
function hideProgress(file) {
    $("tr[data-file-name*='" + file.name + "_" + file.number + "'] div.progress").hide();
}

function updateProgress(file, value) {
    $("tr[data-file-name*='" + file.name + "_" + file.number + "'] div[aria-valuenow]")
        .attr("aria-valuenow", value)
        .css("width", value + "%");
}


//review part


var refreshBtn = $("#refreshReview");
var listResult = $("#listResults");

refreshBtn.click(function () {
    var data = fillReviewForm();
    var isTable = false;
    $.ajax({
        url: SubmittedStudiesDetailsUrl + "?" + $.param(data),
        type: "GET",
        dataType: 'json',
        error: function (jqXhr, textStatus, errorThrown) {
            console.log(textStatus + " // " + errorThrown + " // " + jqXhr.responseText);
        },
        success: function (data, textStatus, jqXhr) {
            console.log(jqXhr.responseText);

            listResult.html("");

            if (data.length > 0) {

                if (isTable) {
                    var table = $("<table class='table' id='result'><thead><tr id='header'></tr></thead><tbody></tbody></table>");
                    var firstItem = data[0].Metadata;
                    for (var j = 0; j < firstItem.length; j++) {
                        table.find("#header").append("<th>" + firstItem[j].Name + "</th>");
                    }

                    for (var i = 0; i < data.length; i++) {
                        var tr = $("<tr></tr>");
                        for (var k = 0; k < firstItem.length; k++) {
                            tr.append("<td>" + data[i].Metadata[k].Value + "</td>");
                        }
                        table.find("tbody").append(tr);
                    }
                    listResult.html(table);
                } else {
                    var cont = $("<div></div>");
                    for (var i = 0; i < data.length; i++) {
                        var div = $("<div class='col-md-4 panel panel-default' style='padding: 0'><dl class='dl-horizontal'></dl></div>");
                        for (var k = 0; k < data[i].Metadata.length; k++) {
                            div.find("dl").append("<dt>" + data[i].Metadata[k].Name + "</dt>" + "<dd>" + data[i].Metadata[k].Value + "</dd>");
                        }
                        div.append("<button class='showFiles btn btn-primary' type='button'>show Files</button>");
                        //div.append("<button class='deleteStudy btn btn-danger' type='button'>delete Study</button>");
                        div.append("<button class='openViewer btn btn-warning' type='button'>open Viewer</button>");

                        div.append("<button class='attachFiles btn btn-primary' type='button'>attach files</button>");


                        cont.append(div);
                    }
                    listResult.html(cont);

                    $(".showFiles").each(function () {
                        var btn = $(this);
                        btn.click(function () {
                            getFilesIds(btn);
                            setTimeout(function () {
                                var scrollPos = $("#filesResult").offset().top;
                                $(window).scrollTop(scrollPos - 70);
                            }, 500);
                        });

                    });

                    $(".attachFiles").each(function () {
                        var btn = $(this);
                        btn.click(function () {
                            attachFiles(btn);
                        });

                    });


                    $(".openViewer").each(function () {
                        var btn = $(this);
                        btn.click(function () {
                            openViewer(btn);
                        });

                    });

                    $(".deleteStudy").each(function () {
                        var btn = $(this);
                        btn.click(function () {
                            deleteStudy(btn);
                        });

                    });
                }
            }
        }
    });
});


function getFilesIds(btn) {
    var dl = btn.siblings("dl");
    var arr = {};
    dl.find("dt").each(function () {
        arr[$(this).text()] = $(this).next("dd").text();
    });
    arr["ParentLevel"] = "Study";
    $.ajax({
        url: SubmittedFilesDetailsUrl + "?" + $.param(arr),
        type: "GET",
        dataType: 'json',
        error: function (jqXhr, textStatus, errorThrown) {
            console.log(textStatus + " // " + errorThrown + " // " + jqXhr.responseText);
        },
        success: function (data, textStatus, jqXhr) {


            var fileList = $("#ListFiles");
            fileList.html("");
            if (data.length === 0) {
                fileList.html($("<table class='table' id='filesResult'><tr><td>study has not files</td></tr></table>"));
                return;
            }
            var table = $("<table class='table' id='filesResult'><thead><tr id='header'></tr></thead><tbody></tbody></table>");
            var firstItem = data[0].Metadata;
            table.find("#header").append("<th>id</th>");
            for (var j = 0; j < firstItem.length; j++) {
                table.find("#header").append("<th>" + firstItem[j].Name + "</th>");
            }
            table.find("#header").append("<th></th>");

            for (var i = 0; i < data.length; i++) {
                var tr = $("<tr></tr>");
                tr.append("<td data-file-id = '" + data[i].FileId + "'>" + data[i].FileId + "</td>");
                for (var k = 0; k < firstItem.length; k++) {
                    tr.append("<td>" + data[i].Metadata[k].Value + "</td>");
                }
                tr.append("<td><button class='deleteFile btn btn-danger' type='button' onclick ='deleteFile(" + data[i].FileId + ")'>delete</button></td>");
                tr.append("<td><button class='downloadFile btn btn-warning' type='button' onclick ='downloadFile(" + data[i].FileId + ")'>download</button></td>");
                table.find("tbody").append(tr);
            }
            fileList.html(table);
            console.log(jqXhr.responseText);
        }
    });
}

function deleteStudy(btn) {
    var dl = btn.siblings("dl");
    var arr = {};

    var id = dl.find("dt:contains('DicomDataStudyId')").next("dd").text();
    arr["TrialNumber"] = dl.find("dt:contains('TrialNumber')").next("dd").text();
    arr["SiteNumber"] = dl.find("dt:contains('SiteNumber')").next("dd").text();



    $.ajax({
        url: SubmittedStudiesDetailsUrl + "/" + id + "?" + $.param(arr),
        type: "DELETE",
        error: function (jqXhr, textStatus, errorThrown) {
            console.log(textStatus + " // " + errorThrown + " // " + jqXhr.responseText);
        },
        success: function (data, textStatus, jqXhr) {
            dl.parent().html("");
            console.log(jqXhr.responseText);
        }
    });
}

function openViewer(btn) {
    var dl = btn.siblings("dl");

    var data = fillForm();
    data.push(
    {
        Name: "DicomDataStudyId",
        Value: dl.find("dt:contains('DicomDataStudyId')").next("dd").text()
    });

    $.ajax({
        url: DicomViewerUrl,
        type: "PUT",
        contentType: "application/json; charset=utf-8",
        data: JSON.stringify(data),
        error: function (jqXhr, textStatus, errorThrown) {
            console.log(textStatus + " // " + errorThrown + " // " + jqXhr.responseText);
        },
        success: function (data, textStatus, jqXhr) {
            var url = jqXhr.getResponseHeader("Location");
            var newwindow = window.open(url, 'temp window to test Claron integration', 'left=(screen.width/2)-400,top=(screen.height/2) - 180,width=800,height=360,toolbar=1,location =1,resizable=1,fullscreen=0');
            newwindow.focus();
        }
    });
}


function attachFiles(btn) {
    var dl = btn.siblings("dl");

    var arr = fillReviewForm();

    var clientName = $("#partialTestData .form-group.formClientName");

    arr["ClientName"] = clientName.find("input.value").val();
    arr["PrimaryParentID"] = arr["ProjectId"];
    arr["SecondaryParentID"] = arr["GroupId"];
    arr["TertiaryParentID"] = arr["TrialId"];
    arr["DicomDataStudyId"] = dl.find("dt:contains('DicomDataStudyId')").next("dd").text();
    arr["parentLevel"] = "Study";

    window.location.href = "../Home/Attaching?" + $.param(arr);
}

function deleteFile(id) {
    $.ajax({
        url: SubmittedFilesDetailsUrl + "/" + id,
        type: "DELETE",
        error: function (jqXhr, textStatus, errorThrown) {
            console.log(textStatus + " // " + errorThrown + " // " + jqXhr.responseText);
        },
        success: function (data, textStatus, jqXhr) {
            $("#filesResult tr > td[data-file-id='" + id + "']").parent().html("");
            console.log(jqXhr.responseText);
        }
    });
}

function downloadFile(id) {
    window.location = SubmittedFilesDetailsUrl + "/" + id;
}

function getGuid() {
    function s4() {
        return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
    }
    return (s4() + s4() + "-" + s4() + "-4" + s4().substr(0, 3) +
        "-" + s4() + "-" + s4() + s4() + s4()).toLowerCase();
}



