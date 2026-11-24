const optional=Symbol('optional');
const plain=(type,options={})=>({...options,type});

export const Type={
  String:(options={})=>plain('string',options),Boolean:(options={})=>plain('boolean',options),
  Integer:(options={})=>plain('integer',options),Number:(options={})=>plain('number',options),
  Literal:value=>({const:value,type:typeof value==='number'?'number':typeof value}),
  Array:(items,options={})=>({...options,type:'array',items}),
  Union:items=>({oneOf:items}),
  Optional:schema=>({...schema,[optional]:true}),
  Object:(properties,options={})=>{
    const normalized={};const required=[];
    for(const [name,schema] of Object.entries(properties)){const {[optional]:isOptional,...value}=schema;normalized[name]=value;if(!isOptional)required.push(name);}
    return {...options,type:'object',additionalProperties:false,properties:normalized,...(required.length?{required}:{})};
  }
};
