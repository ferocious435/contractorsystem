using System;
using System.IO;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using Autodesk.AutoCAD.Runtime;
using Autodesk.AutoCAD.DatabaseServices;
public class DenyExternal : HostApplicationServices {
 public readonly List<string> Requests=new List<string>();
 public override string FindFile(string name, Database db, FindFileHint hint){Requests.Add(hint+":"+name);return null;}
 public override string GetRemoteFile(Uri url,bool ignoreCache){Requests.Add("REMOTE:"+url);throw new InvalidOperationException("Remote file access disabled");}
 public override void PutRemoteFile(Uri url,string file){Requests.Add("REMOTE_WRITE:"+url);throw new InvalidOperationException("Remote file access disabled");}
}
public class CadProbe {
 [CommandMethod("R05PROBE")]
 public void Run(){
  var previous=HostApplicationServices.Current; var guard=new DenyExternal();
  var result=new Dictionary<string,object>();
  try { HostApplicationServices.Current=guard; using(var db=new Database(false,true)) {
   db.ReadDwgFile(Environment.GetEnvironmentVariable("CAD_PROBE_INPUT"),FileOpenMode.OpenForReadAndAllShare,true,"");
   using(var tr=db.TransactionManager.StartOpenCloseTransaction()){
    var geometry=new List<object>(); var layouts=new List<object>(); var types=new Dictionary<string,int>(); var refs=new List<object>(); var texts=new List<object>(); int total=0;
    var bt=(BlockTable)tr.GetObject(db.BlockTableId,OpenMode.ForRead);
    foreach(ObjectId id in bt){
     var block=(BlockTableRecord)tr.GetObject(id,OpenMode.ForRead);
     if(block.IsFromExternalReference || block.IsFromOverlayReference){refs.Add(new {name=block.Name,path=block.PathName,overlay=block.IsFromOverlayReference});continue;}
     int count=0;
     foreach(ObjectId eid in block){
      var ent=tr.GetObject(eid,OpenMode.ForRead,false) as Entity; if(ent==null)continue;
      total++;count++; var line=ent as Line;
      if(line!=null)geometry.Add(new {block=block.Name,handle=ent.Handle.ToString(),layer=ent.Layer,kind="Line",start=new[]{line.StartPoint.X,line.StartPoint.Y,line.StartPoint.Z},end=new[]{line.EndPoint.X,line.EndPoint.Y,line.EndPoint.Z}});
      var type=ent.GetType().Name; if(!types.ContainsKey(type))types[type]=0;types[type]++;
      if(texts.Count<30000){var t=ent as DBText;var m=ent as MText;if(t!=null||m!=null)texts.Add(new {block=block.Name,handle=ent.Handle.ToString(),layer=ent.Layer,text=t!=null?t.TextString:m.Contents});}
     }
     if(block.IsLayout)layouts.Add(new {name=block.Name,count=count,handle=block.Handle.ToString()});
    }
    var dict=(DBDictionary)tr.GetObject(db.LayoutDictionaryId,OpenMode.ForRead);var layoutNames=new List<string>();foreach(DBDictionaryEntry e in dict)layoutNames.Add(e.Key);
    result["geometry"]=geometry;result["layouts"]=layoutNames;result["layoutBlocks"]=layouts;result["types"]=types;result["xrefs"]=refs;result["texts"]=texts;result["entityCount"]=total;
   }
  } result["status"]="INVENTORIED";} catch(System.Exception ex){result["status"]="ERROR";result["error"]=ex.ToString();}
  finally {result["fileRequestsDenied"]=guard.Requests;HostApplicationServices.Current=previous;File.WriteAllText(Environment.GetEnvironmentVariable("CAD_PROBE_OUTPUT"),new JavaScriptSerializer{MaxJsonLength=100000000}.Serialize(result));}
 }
}
